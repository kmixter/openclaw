import { describe, expect, it } from "vitest";
import { parseReplyDirectives } from "./reply-directives.js";

describe("parseReplyDirectives", () => {
  it("returns isSilent for bare NO_REPLY", () => {
    const result = parseReplyDirectives("NO_REPLY");
    expect(result.isSilent).toBe(true);
    expect(result.silentTokenStripped).toBe(false);
    expect(result.text).toBe("");
  });

  it("returns isSilent for NO_REPLY with whitespace", () => {
    const result = parseReplyDirectives("  NO_REPLY  ");
    expect(result.isSilent).toBe(true);
    expect(result.silentTokenStripped).toBe(false);
    expect(result.text).toBe("");
  });

  it("strips NO_REPLY appended to real content", () => {
    const result = parseReplyDirectives("Welcome back! Hope you're doing well.\n\nNO_REPLY");
    expect(result.isSilent).toBe(false);
    expect(result.silentTokenStripped).toBe(true);
    expect(result.text).toBe("Welcome back! Hope you're doing well.");
  });

  it("strips NO_REPLY appended to reply_to_current content", () => {
    const result = parseReplyDirectives(
      "[[reply_to_current]] Hello there! How are you?\n\nNO_REPLY",
    );
    expect(result.isSilent).toBe(false);
    expect(result.silentTokenStripped).toBe(true);
    expect(result.text).toBe("Hello there! How are you?");
    expect(result.replyToCurrent).toBe(true);
  });

  it("does not strip NO_REPLY when it is the only content after reply tag", () => {
    const result = parseReplyDirectives("[[reply_to_current]] NO_REPLY");
    expect(result.isSilent).toBe(true);
    expect(result.silentTokenStripped).toBe(false);
    expect(result.text).toBe("");
  });

  it("handles normal text without NO_REPLY", () => {
    const result = parseReplyDirectives("Just a normal reply here.");
    expect(result.isSilent).toBe(false);
    expect(result.silentTokenStripped).toBe(false);
    expect(result.text).toBe("Just a normal reply here.");
  });
});
