import { Type } from "@sinclair/typebox";
import { loadConfig } from "../../config/config.js";
import {
  resolveStorePath,
  updateSessionStore,
  resolveAgentIdFromSessionKey,
} from "../../config/sessions.js";
import { callGateway } from "../../gateway/call.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SessionResetToolSchema = Type.Object({
  message: Type.Optional(Type.String()),
});

export function createSessionResetTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Session Reset",
    name: "session_reset",
    description:
      "Reset your own session. Optionally inject a system message that will appear as context on the next interaction.",
    parameters: SessionResetToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const message = readStringParam(params, "message")?.trim() || undefined;

      const sessionKey = opts?.agentSessionKey;
      if (!sessionKey) {
        return jsonResult({ status: "error", error: "No session key available for reset." });
      }

      try {
        const response = await callGateway<{ ok: boolean; key: string }>({
          method: "sessions.reset",
          params: { key: sessionKey },
          timeoutMs: 10_000,
        });

        const resolvedKey = response?.key ?? sessionKey;

        if (message) {
          const cfg = loadConfig();
          const agentId = resolveAgentIdFromSessionKey(sessionKey);
          const storePath = resolveStorePath(cfg.session?.store, { agentId });
          await updateSessionStore(storePath, (store) => {
            const entry = store[resolvedKey];
            if (entry) {
              entry.pendingSystemMessage = message;
            }
          });
        }

        return jsonResult({
          status: "ok",
          message: message ? "Session reset with pending system message." : "Session reset.",
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return jsonResult({ status: "error", error: errorMessage });
      }
    },
  };
}
