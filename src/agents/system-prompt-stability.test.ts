import { describe, expect, it, beforeEach } from "vitest";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import { loadWorkspaceBootstrapFiles, DEFAULT_AGENTS_FILENAME } from "./workspace.js";

describe("system prompt stability for cache hits", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await makeTempWorkspace("openclaw-system-prompt-stability-");
  });

  it("returns identical results for same inputs across multiple calls", async () => {
    const agentsContent = "# AGENTS.md - Your Workspace\n\nTest agents file.";

    await writeWorkspaceFile({
      dir: workspaceDir,
      name: DEFAULT_AGENTS_FILENAME,
      content: agentsContent,
    });

    // Load the same workspace multiple times
    const results = await Promise.all([
      loadWorkspaceBootstrapFiles(workspaceDir),
      loadWorkspaceBootstrapFiles(workspaceDir),
      loadWorkspaceBootstrapFiles(workspaceDir),
      loadWorkspaceBootstrapFiles(workspaceDir),
      loadWorkspaceBootstrapFiles(workspaceDir),
    ]);

    // All results should be structurally identical
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(results[0]);
    }

    // Verify specific content consistency
    const agentsFiles = results.map((result) =>
      result.find((f) => f.name === DEFAULT_AGENTS_FILENAME),
    );

    for (let i = 1; i < agentsFiles.length; i++) {
      expect(agentsFiles[i]?.content).toBe(agentsFiles[0]?.content);
    }

    expect(agentsFiles[0]?.content).toBe(agentsContent);
  });

  it("returns consistent ordering across calls", async () => {
    await writeWorkspaceFile({
      dir: workspaceDir,
      name: DEFAULT_AGENTS_FILENAME,
      content: "# Agents content",
    });

    // Load multiple times
    const results = await Promise.all([
      loadWorkspaceBootstrapFiles(workspaceDir),
      loadWorkspaceBootstrapFiles(workspaceDir),
      loadWorkspaceBootstrapFiles(workspaceDir),
    ]);

    // All results should have the same file order
    for (let i = 1; i < results.length; i++) {
      const names1 = results[0].map((f) => f.name);
      const namesI = results[i].map((f) => f.name);
      expect(namesI).toEqual(names1);
    }
  });

  it("maintains consistency even with missing files", async () => {
    // Only create AGENTS.md, leave BOOTSTRAP.md missing
    await writeWorkspaceFile({
      dir: workspaceDir,
      name: DEFAULT_AGENTS_FILENAME,
      content: "# Agents only",
    });

    // Load multiple times
    const results = await Promise.all([
      loadWorkspaceBootstrapFiles(workspaceDir),
      loadWorkspaceBootstrapFiles(workspaceDir),
      loadWorkspaceBootstrapFiles(workspaceDir),
    ]);

    // All results should be identical
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(results[0]);
    }

    // Verify present/missing files are consistently marked
    for (const result of results) {
      const agentsFile = result.find((f) => f.name === DEFAULT_AGENTS_FILENAME);
      const bootstrapFile = result.find((f) => f.name === "BOOTSTRAP.md");

      expect(agentsFile?.missing).toBe(false);
      expect(agentsFile?.content).toBe("# Agents only");
      expect(bootstrapFile?.missing).toBe(true);
      expect(bootstrapFile?.content).toBeUndefined();
    }
  });

  it("maintains consistency across concurrent loads", async () => {
    const content = "# Concurrent load test";
    await writeWorkspaceFile({ dir: workspaceDir, name: DEFAULT_AGENTS_FILENAME, content });

    // Start multiple concurrent loads
    const promises = Array.from({ length: 20 }, () => loadWorkspaceBootstrapFiles(workspaceDir));

    const results = await Promise.all(promises);

    // All concurrent results should be identical
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(results[0]);
    }

    // Verify content consistency
    for (const result of results) {
      const agentsFile = result.find((f) => f.name === DEFAULT_AGENTS_FILENAME);
      expect(agentsFile?.content).toBe(content);
      expect(agentsFile?.missing).toBe(false);
    }
  });
});
