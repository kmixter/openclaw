import { describe, expect, it } from "vitest";
import { __testing } from "./run.js";

const { extractRetryAfterMs } = __testing;

describe("extractRetryAfterMs", () => {
  it("returns undefined for null/undefined", () => {
    expect(extractRetryAfterMs(null)).toBeUndefined();
    expect(extractRetryAfterMs(undefined)).toBeUndefined();
  });

  it("parses retry-after HTTP header", () => {
    const err = {
      headers: {
        get: (name: string) => (name === "retry-after" ? "30" : null),
      },
    };
    expect(extractRetryAfterMs(err)).toBe(30_000);
  });

  it("parses Google RetryInfo details", () => {
    const err = {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "52s",
          },
        ],
      },
    };
    expect(extractRetryAfterMs(err)).toBe(52_000);
  });

  it("parses 'retry in Xs' from error message (Google SDK wrapped errors)", () => {
    const err = new Error(
      "Cloud Code Assist API error (429): You exceeded your current quota. " +
        "Please retry in 51.427806843s.",
    );
    const result = extractRetryAfterMs(err);
    expect(result).toBeGreaterThan(51_000);
    expect(result).toBeLessThan(52_000);
  });

  it("parses 'retry in Xs' with integer seconds", () => {
    const err = new Error("Rate limited. Please retry in 60s.");
    expect(extractRetryAfterMs(err)).toBe(60_000);
  });

  it("prefers HTTP header over message text", () => {
    const err = {
      message: "Please retry in 100s.",
      headers: {
        get: (name: string) => (name === "retry-after" ? "5" : null),
      },
    };
    expect(extractRetryAfterMs(err)).toBe(5_000);
  });

  it("returns undefined when no retry info is present", () => {
    const err = new Error("Some random error with no retry info");
    expect(extractRetryAfterMs(err)).toBeUndefined();
  });
});
