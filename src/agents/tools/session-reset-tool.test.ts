import { describe, expect, it, vi } from "vitest";

const callGatewaySpy = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGatewaySpy(...args),
}));

const updateSessionStoreSpy = vi.fn();
vi.mock("../../config/sessions.js", () => ({
  resolveStorePath: () => "/mock/store.json",
  resolveAgentIdFromSessionKey: () => "default",
  updateSessionStore: (...args: unknown[]) => updateSessionStoreSpy(...args),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ session: {} }),
}));

const { createSessionResetTool } = await import("./session-reset-tool.js");

describe("createSessionResetTool", () => {
  it("returns error when no session key is available", async () => {
    const tool = createSessionResetTool();
    const result = await tool.execute("call-1", {});
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.status).toBe("error");
    expect(parsed.error).toContain("No session key");
  });

  it("calls sessions.reset on the gateway", async () => {
    callGatewaySpy.mockResolvedValueOnce({ ok: true, key: "agent:default:main" });
    const tool = createSessionResetTool({ agentSessionKey: "agent:default:main" });
    const result = await tool.execute("call-2", {});
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.status).toBe("ok");
    expect(callGatewaySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "sessions.reset",
        params: { key: "agent:default:main" },
      }),
    );
    expect(updateSessionStoreSpy).not.toHaveBeenCalled();
  });

  it("persists pendingSystemMessage when message is provided", async () => {
    callGatewaySpy.mockResolvedValueOnce({ ok: true, key: "agent:default:main" });
    updateSessionStoreSpy.mockImplementationOnce(
      async (_path: string, mutator: (store: Record<string, unknown>) => void) => {
        const store: Record<string, Record<string, unknown>> = {
          "agent:default:main": { sessionId: "s1", updatedAt: 1 },
        };
        mutator(store);
        expect(store["agent:default:main"].pendingSystemMessage).toBe("You dozed off.");
      },
    );

    const tool = createSessionResetTool({ agentSessionKey: "agent:default:main" });
    const result = await tool.execute("call-3", { message: "You dozed off." });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.status).toBe("ok");
    expect(parsed.message).toContain("pending system message");
    expect(updateSessionStoreSpy).toHaveBeenCalledOnce();
  });

  it("returns error when gateway call fails", async () => {
    callGatewaySpy.mockRejectedValueOnce(new Error("gateway timeout"));
    const tool = createSessionResetTool({ agentSessionKey: "agent:default:main" });
    const result = await tool.execute("call-4", {});
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.status).toBe("error");
    expect(parsed.error).toContain("gateway timeout");
  });
});
