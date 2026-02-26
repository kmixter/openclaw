import { describe, expect, it } from "vitest";
import type { ResolvedTimeFormat } from "../../agents/date-time.js";
import type { TemplateContext } from "../templating.js";
import {
  buildInboundMetaSystemPrompt,
  buildInboundUserContextPrefix,
  buildTimeFields,
  type TimeFields,
} from "./inbound-meta.js";

function parseInboundMetaPayload(text: string): Record<string, unknown> {
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("missing inbound meta json block");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function parseConversationInfoPayload(text: string): Record<string, unknown> {
  const match = text.match(/Conversation info \(untrusted metadata\):\n```json\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("missing conversation info json block");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("buildInboundMetaSystemPrompt", () => {
  it("includes session-stable routing fields", () => {
    const prompt = buildInboundMetaSystemPrompt({
      MessageSid: "123",
      MessageSidFull: "123",
      ReplyToId: "99",
      OriginatingTo: "telegram:5494292670",
      OriginatingChannel: "telegram",
      Provider: "telegram",
      Surface: "telegram",
      ChatType: "direct",
    } as TemplateContext);

    const payload = parseInboundMetaPayload(prompt);
    expect(payload["schema"]).toBe("openclaw.inbound_meta.v1");
    expect(payload["chat_id"]).toBe("telegram:5494292670");
    expect(payload["channel"]).toBe("telegram");
  });

  it("does not include per-turn message identifiers (cache stability)", () => {
    const prompt = buildInboundMetaSystemPrompt({
      MessageSid: "123",
      MessageSidFull: "123",
      ReplyToId: "99",
      SenderId: "289522496",
      OriginatingTo: "telegram:5494292670",
      OriginatingChannel: "telegram",
      Provider: "telegram",
      Surface: "telegram",
      ChatType: "direct",
    } as TemplateContext);

    const payload = parseInboundMetaPayload(prompt);
    expect(payload["message_id"]).toBeUndefined();
    expect(payload["message_id_full"]).toBeUndefined();
    expect(payload["reply_to_id"]).toBeUndefined();
    expect(payload["sender_id"]).toBeUndefined();
  });

  it("omits sender_id when blank", () => {
    const prompt = buildInboundMetaSystemPrompt({
      MessageSid: "458",
      SenderId: "   ",
      OriginatingTo: "telegram:-1001249586642",
      OriginatingChannel: "telegram",
      Provider: "telegram",
      Surface: "telegram",
      ChatType: "group",
    } as TemplateContext);

    const payload = parseInboundMetaPayload(prompt);
    expect(payload["sender_id"]).toBeUndefined();
  });
});

describe("buildInboundUserContextPrefix", () => {
  it("omits conversation label block for direct chats", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      ConversationLabel: "openclaw-tui",
    } as TemplateContext);

    expect(text).toBe("");
  });

  it("keeps conversation label for group chats", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "group",
      ConversationLabel: "ops-room",
    } as TemplateContext);

    expect(text).toContain("Conversation info (untrusted metadata):");
    expect(text).toContain('"conversation_label": "ops-room"');
  });

  it("includes sender identifier in conversation info", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      SenderE164: " +15551234567 ",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["sender"]).toBe("+15551234567");
  });

  it("includes message_id in conversation info", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      MessageSid: "  msg-123  ",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["message_id"]).toBe("msg-123");
  });

  it("includes message_id_full when it differs from message_id", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "group",
      MessageSid: "short-id",
      MessageSidFull: "full-provider-message-id",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["message_id"]).toBe("short-id");
    expect(conversationInfo["message_id_full"]).toBe("full-provider-message-id");
  });

  it("omits message_id_full when it matches message_id", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      MessageSid: "same-id",
      MessageSidFull: "same-id",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["message_id"]).toBe("same-id");
    expect(conversationInfo["message_id_full"]).toBeUndefined();
  });

  it("includes reply_to_id in conversation info", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      MessageSid: "msg-200",
      ReplyToId: "msg-199",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["reply_to_id"]).toBe("msg-199");
  });

  it("includes sender_id in conversation info", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "group",
      MessageSid: "msg-456",
      SenderId: "289522496",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["sender_id"]).toBe("289522496");
  });

  it("trims sender_id in conversation info", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      MessageSid: "msg-457",
      SenderId: "  289522496  ",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["sender_id"]).toBe("289522496");
  });

  it("falls back to SenderId when sender phone is missing", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      SenderId: " user@example.com ",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["sender"]).toBe("user@example.com");
  });
});

describe("buildTimeFields", () => {
  const baseOpts = {
    nowMs: Date.UTC(2026, 1, 22, 18, 12, 0), // 2026-02-22T18:12:00Z
    userTimezone: "America/New_York",
    timeFormat: "12" as ResolvedTimeFormat,
  };

  it("first message (no previous timestamps): returns current_time only", () => {
    const result = buildTimeFields(baseOpts);
    expect(result.current_time).toBeDefined();
    expect(result.time_since_last_user_message).toBeUndefined();
    // 2026-02-22 18:12 UTC = Sun 1:12 PM ET
    expect(result.current_time).toMatch(/Sun\s+1:12\s*PM/i);
  });

  it("within 3 minutes of last user message: returns {} (suppressed)", () => {
    const result = buildTimeFields({
      ...baseOpts,
      lastUserMessageAt: baseOpts.nowMs - 2 * 60 * 1000,
    });
    expect(result).toEqual({});
  });

  it("exactly 3 minutes: still suppressed", () => {
    const result = buildTimeFields({
      ...baseOpts,
      lastUserMessageAt: baseOpts.nowMs - 3 * 60 * 1000,
    });
    expect(result).toEqual({});
  });

  it("just over 3 minutes: returns both fields (rounded to minute)", () => {
    const result = buildTimeFields({
      ...baseOpts,
      lastUserMessageAt: baseOpts.nowMs - 3 * 60 * 1000 - 1000,
    });
    expect(result.current_time).toBeDefined();
    expect(result.time_since_last_user_message).toBe("3m");
  });

  it("long elapsed duration uses compact format", () => {
    const eighteenHours = 18 * 60 * 60 * 1000 + 20 * 60 * 1000;
    const result = buildTimeFields({
      ...baseOpts,
      lastUserMessageAt: baseOpts.nowMs - eighteenHours,
    });
    expect(result.time_since_last_user_message).toBe("18h 20m");
  });

  it("multi-day elapsed duration", () => {
    const twoDays = 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000;
    const result = buildTimeFields({
      ...baseOpts,
      lastUserMessageAt: baseOpts.nowMs - twoDays,
    });
    expect(result.time_since_last_user_message).toBe("2d 3h");
  });

  it("24h format: uses h23 hourCycle", () => {
    const result = buildTimeFields({
      ...baseOpts,
      timeFormat: "24",
    });
    expect(result.current_time).toBeDefined();
    // 18:12 UTC = Sun 13:12 ET
    expect(result.current_time).toBe("Sun 13:12");
  });

  it("12h format: includes AM/PM", () => {
    const result = buildTimeFields(baseOpts);
    expect(result.current_time).toMatch(/PM/i);
  });

  it("5 minutes elapsed: returns both fields", () => {
    const result = buildTimeFields({
      ...baseOpts,
      lastUserMessageAt: baseOpts.nowMs - 5 * 60 * 1000,
    });
    expect(result.current_time).toBeDefined();
    expect(result.time_since_last_user_message).toBe("5m");
  });
});

describe("buildInboundUserContextPrefix with timeFields", () => {
  const minimalCtx: TemplateContext = {
    Body: "hello",
    MessageSid: "msg-123",
    SenderId: "user-1",
  };

  it("includes time fields in conversationInfo JSON when provided", () => {
    const timeFields: TimeFields = {
      current_time: "1:12 PM",
      time_since_last_user_message: "18h 20m",
    };
    const result = buildInboundUserContextPrefix(minimalCtx, { timeFields });
    expect(result).toContain('"current_time": "1:12 PM"');
    expect(result).toContain('"time_since_last_user_message": "18h 20m"');
  });

  it("includes only current_time when time_since_last_user_message is undefined", () => {
    const timeFields: TimeFields = { current_time: "1:12 PM" };
    const result = buildInboundUserContextPrefix(minimalCtx, { timeFields });
    expect(result).toContain('"current_time": "1:12 PM"');
    expect(result).not.toContain("time_since_last_user_message");
  });

  it("does not include time fields when not provided", () => {
    const result = buildInboundUserContextPrefix(minimalCtx);
    expect(result).not.toContain("current_time");
    expect(result).not.toContain("time_since_last_user_message");
  });

  it("does not include time fields when empty object provided", () => {
    const result = buildInboundUserContextPrefix(minimalCtx, { timeFields: {} });
    expect(result).not.toContain("current_time");
    expect(result).not.toContain("time_since_last_user_message");
  });
});

describe("buildTimeFields heartbeat/cron scenario", () => {
  const baseOpts = {
    nowMs: Date.UTC(2026, 1, 23, 14, 0, 0), // 2026-02-23T14:00:00Z
    userTimezone: "America/New_York",
    timeFormat: "12" as ResolvedTimeFormat,
  };
  const userMessageAt = Date.UTC(2026, 1, 23, 7, 0, 0); // 7am UTC

  it("heartbeat 7h after user message shows elapsed from user message", () => {
    const result = buildTimeFields({
      ...baseOpts,
      lastUserMessageAt: userMessageAt,
    });
    expect(result.current_time).toBeDefined();
    expect(result.time_since_last_user_message).toBe("7h");
  });

  it("next user message still measures from original user message (not heartbeat)", () => {
    // If lastUserMessageAt is NOT updated by the heartbeat, a user message
    // 2h after the heartbeat (9h after original) should show 9h elapsed.
    const result = buildTimeFields({
      ...baseOpts,
      nowMs: Date.UTC(2026, 1, 23, 16, 0, 0), // 4pm UTC, 9h after user
      lastUserMessageAt: userMessageAt,
    });
    expect(result.time_since_last_user_message).toBe("9h");
  });
});
