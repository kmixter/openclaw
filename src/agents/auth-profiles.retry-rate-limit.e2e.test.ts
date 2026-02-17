import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureAuthProfileStore, markAuthProfileFailure } from "./auth-profiles.js";
import { calculateAuthProfileCooldownMs } from "./auth-profiles/usage.js";

describe("retryRateLimit config", () => {
  it("uses fixed 60s cooldown for rate_limit when retryRateLimit is enabled", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "google:default": {
              type: "api_key",
              provider: "google",
              key: "test-key",
            },
          },
        }),
      );

      const store = ensureAuthProfileStore(agentDir);
      const startedAt = Date.now();

      // Simulate multiple rate limit failures
      for (let i = 0; i < 3; i++) {
        await markAuthProfileFailure({
          store,
          profileId: "google:default",
          reason: "rate_limit",
          agentDir,
          cfg: { agents: { defaults: { retryRateLimit: true } } } as never,
        });
      }

      const cooldownUntil = store.usageStats?.["google:default"]?.cooldownUntil;
      expect(typeof cooldownUntil).toBe("number");
      const remainingMs = (cooldownUntil as number) - startedAt;
      // Should be ~60s regardless of how many failures (no exponential backoff)
      expect(remainingMs).toBeGreaterThan(50_000);
      expect(remainingMs).toBeLessThan(70_000);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("uses exponential backoff for rate_limit when retryRateLimit is NOT enabled", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "google:default": {
              type: "api_key",
              provider: "google",
              key: "test-key",
            },
          },
        }),
      );

      const store = ensureAuthProfileStore(agentDir);
      const startedAt = Date.now();

      // Simulate 3 rate limit failures without the flag
      for (let i = 0; i < 3; i++) {
        await markAuthProfileFailure({
          store,
          profileId: "google:default",
          reason: "rate_limit",
          agentDir,
          // No cfg → retryRateLimit defaults to false
        });
      }

      const cooldownUntil = store.usageStats?.["google:default"]?.cooldownUntil;
      expect(typeof cooldownUntil).toBe("number");
      const remainingMs = (cooldownUntil as number) - startedAt;
      // 3rd failure with exponential backoff: 60s * 5^2 = 1500s = 25min
      const expectedMs = calculateAuthProfileCooldownMs(3);
      expect(remainingMs).toBeGreaterThan(expectedMs - 5_000);
      expect(remainingMs).toBeLessThan(expectedMs + 5_000);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("still uses exponential backoff for non-rate-limit failures even with retryRateLimit", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "google:default": {
              type: "api_key",
              provider: "google",
              key: "test-key",
            },
          },
        }),
      );

      const store = ensureAuthProfileStore(agentDir);
      const startedAt = Date.now();

      await markAuthProfileFailure({
        store,
        profileId: "google:default",
        reason: "unknown",
        agentDir,
        cfg: { agents: { defaults: { retryRateLimit: true } } } as never,
      });

      const cooldownUntil = store.usageStats?.["google:default"]?.cooldownUntil;
      expect(typeof cooldownUntil).toBe("number");
      const remainingMs = (cooldownUntil as number) - startedAt;
      // Should use standard exponential backoff (1min for first failure)
      const expectedMs = calculateAuthProfileCooldownMs(1);
      expect(remainingMs).toBeGreaterThan(expectedMs - 5_000);
      expect(remainingMs).toBeLessThan(expectedMs + 5_000);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
