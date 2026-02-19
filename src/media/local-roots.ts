import os from "node:os";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";

function buildMediaLocalRoots(stateDir: string): string[] {
  const resolvedStateDir = path.resolve(stateDir);
  const preferredTmpDir = resolvePreferredOpenClawTmpDir();
  const roots = [
    preferredTmpDir,
    path.join(resolvedStateDir, "media"),
    path.join(resolvedStateDir, "agents"),
    path.join(resolvedStateDir, "workspace"),
    path.join(resolvedStateDir, "sandboxes"),
  ];
  // On macOS, $TMPDIR is the per-user temp dir (e.g. /var/folders/.../T/) which
  // differs from os.tmpdir() (/tmp). TTS and other modules may write to either.
  const envTmpdir = process.env.TMPDIR;
  if (envTmpdir && envTmpdir !== os.tmpdir() && envTmpdir !== preferredTmpDir) {
    roots.push(envTmpdir);
  }
  // On macOS, /tmp is a symlink to /private/tmp and differs from os.tmpdir()
  // (which returns /var/folders/...). Scripts commonly write to /tmp.
  if (process.platform === "darwin") {
    roots.push("/tmp");
  }
  return roots;
}

export function getDefaultMediaLocalRoots(): readonly string[] {
  return buildMediaLocalRoots(resolveStateDir());
}

export function getAgentScopedMediaLocalRoots(
  cfg: OpenClawConfig,
  agentId?: string,
): readonly string[] {
  const roots = buildMediaLocalRoots(resolveStateDir());
  if (!agentId?.trim()) {
    return roots;
  }
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  if (!workspaceDir) {
    return roots;
  }
  const normalizedWorkspaceDir = path.resolve(workspaceDir);
  if (!roots.includes(normalizedWorkspaceDir)) {
    roots.push(normalizedWorkspaceDir);
  }
  return roots;
}
