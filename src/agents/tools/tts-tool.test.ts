import { describe, expect, it, vi } from "vitest";

vi.mock("../../auto-reply/tokens.js", () => ({
  SILENT_REPLY_TOKEN: "QUIET_TOKEN",
}));

// Capture the text passed to textToSpeech so we can verify noise stripping.
const textToSpeechSpy = vi.fn().mockResolvedValue({
  success: true,
  audioPath: "/tmp/test-voice.mp3",
  provider: "openai",
  voiceCompatible: false,
});
vi.mock("../../tts/tts.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    textToSpeech: (...args: unknown[]) => textToSpeechSpy(...args),
  };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

const { createTtsTool } = await import("./tts-tool.js");

describe("createTtsTool", () => {
  it("uses SILENT_REPLY_TOKEN in guidance text", () => {
    const tool = createTtsTool();

    expect(tool.description).toContain("QUIET_TOKEN");
    expect(tool.description).not.toContain("NO_REPLY");
  });

  it("strips emoji from text before calling textToSpeech", async () => {
    const tool = createTtsTool({ config: {} as never });
    await tool.execute("call-1", { text: "hello 🌿✨ world 🩹💖" });

    expect(textToSpeechSpy).toHaveBeenCalledOnce();
    const passedText = textToSpeechSpy.mock.calls[0][0].text;
    expect(passedText).toBe("hello world");
  });

  it("strips residual directive tags from text", async () => {
    const tool = createTtsTool({ config: {} as never });
    await tool.execute("call-2", { text: "hey [[reply_to_current]] there" });

    const passedText = textToSpeechSpy.mock.calls.at(-1)![0].text;
    expect(passedText).toBe("hey there");
  });
});
