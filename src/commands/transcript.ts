import fs from "node:fs";
import { loadConfig } from "../config/config.js";
import { loadSessionStore, resolveStorePath, type SessionEntry } from "../config/sessions.js";
import {
  parseTranscriptLine,
  readSessionMessages,
  resolveSessionTranscriptCandidates,
} from "../gateway/session-utils.fs.js";
import { info } from "../globals.js";
import type { RuntimeEnv } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";

type ContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  arguments?: unknown;
  thoughtSignature?: string;
  textSignature?: string;
  source?: unknown;
};

type TranscriptMessage = {
  role?: string;
  content?: string | ContentBlock[];
  timestamp?: number;
  // toolResult role fields
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: unknown;
  // compaction synthetic messages
  __openclaw?: { kind?: string; isDiff?: boolean };
};

const ROLE_COLORS: Record<string, (s: string) => string> = {
  user: theme.accent,
  assistant: theme.info,
  system: theme.warn,
  toolresult: theme.muted,
};

const TRUNCATE_LEN = 5000;

function formatTimestamp(ts: number | undefined): string {
  if (!ts) {
    return "";
  }
  const d = new Date(ts);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function renderBlock(block: ContentBlock, opts: { thinking: boolean }, rich: boolean): string[] {
  const lines: string[] = [];
  switch (block.type) {
    case "text":
    case "output_text":
    case "input_text":
      if (typeof block.text === "string" && block.text.trim()) {
        lines.push(block.text);
      }
      break;
    case "toolCall": {
      const label = `[toolCall: ${block.name ?? "unknown"}]`;
      lines.push(rich ? theme.muted(label) : label);
      if (block.arguments !== undefined) {
        const raw =
          typeof block.arguments === "string"
            ? block.arguments
            : JSON.stringify(block.arguments, null, 2);
        lines.push(truncate(raw, TRUNCATE_LEN));
      }
      break;
    }
    case "thinking":
      if (opts.thinking) {
        const label = "[thinking]";
        lines.push(rich ? theme.muted(label) : label);
        const text = block.thinking ?? block.text;
        if (typeof text === "string" && text.trim()) {
          lines.push(text);
        }
      } else {
        const label = "[thinking hidden, use --thinking to show]";
        lines.push(rich ? theme.muted(label) : label);
      }
      break;
    case "image": {
      const label = "[image]";
      lines.push(rich ? theme.muted(label) : label);
      break;
    }
    default: {
      const label = `[${block.type}]`;
      lines.push(rich ? theme.muted(label) : label);
      const text = block.text ?? block.thinking;
      if (typeof text === "string" && text.trim()) {
        lines.push(truncate(text, TRUNCATE_LEN));
      }
      break;
    }
  }
  return lines;
}

function renderToolResultMessage(msg: TranscriptMessage, rich: boolean): string[] {
  const lines: string[] = [];
  const toolLabel = `[toolResult: ${msg.toolName ?? "unknown"}]`;
  lines.push(rich ? theme.muted(toolLabel) : toolLabel);
  if (msg.isError) {
    const errLabel = "[error]";
    lines.push(rich ? theme.error(errLabel) : errLabel);
  }
  if (typeof msg.content === "string" && msg.content.trim()) {
    lines.push(truncate(msg.content, TRUNCATE_LEN));
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (typeof block.text === "string" && block.text.trim()) {
        lines.push(truncate(block.text, TRUNCATE_LEN));
      }
    }
  }
  return lines;
}

function renderMessage(msg: TranscriptMessage, opts: { thinking: boolean }, rich: boolean): string {
  const roleLower = (msg.role ?? "unknown").toLowerCase();
  const isSystemPrompt = msg.__openclaw?.kind === "system-prompt";
  const isDiff = msg.__openclaw?.isDiff === true;
  const role = isSystemPrompt
    ? isDiff
      ? "SYSTEM \u0394PROMPT"
      : "SYSTEM PROMPT"
    : roleLower.toUpperCase();
  const isCompaction = msg.__openclaw?.kind === "compaction";

  const ts = formatTimestamp(msg.timestamp);
  const colorFn = ROLE_COLORS[roleLower];

  let header = `${role.padEnd(12)} [${ts}]`;
  if (isCompaction) {
    header += " --- compaction ---";
  }
  if (rich && colorFn) {
    header = colorFn(header);
  }

  const lines: string[] = [header];

  if (roleLower === "toolresult") {
    lines.push(...renderToolResultMessage(msg, rich));
    return lines.join("\n");
  }

  if (typeof msg.content === "string") {
    if (msg.content.trim()) {
      lines.push(msg.content);
    }
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block && typeof block === "object") {
        lines.push(...renderBlock(block, opts, rich));
      }
    }
  }

  return lines.join("\n");
}

function shouldIncludeMessage(msg: TranscriptMessage, opts: { system?: boolean }): boolean {
  if (!opts.system && msg.__openclaw?.kind === "system-prompt") {
    return false;
  }
  return true;
}

async function waitForFile(path: string, runtime: RuntimeEnv): Promise<void> {
  if (fs.existsSync(path)) {
    return;
  }
  runtime.log(info("Waiting for transcript file..."));
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (fs.existsSync(path)) {
        clearInterval(check);
        resolve();
      }
    }, 300);
  });
}

async function followTranscript(
  sessionKey: string,
  storePath: string,
  initialFilePath: string,
  initialSessionId: string,
  opts: { thinking?: boolean; system?: boolean },
  runtime: RuntimeEnv,
): Promise<void> {
  const rich = isRich();
  let offset = 0;
  let partialLine = "";
  let currentPath = initialFilePath;
  let currentSessionId = initialSessionId;
  let stopped = false;

  // If file already exists, start from end (initial dump already printed).
  try {
    offset = fs.statSync(currentPath).size;
  } catch {
    // File doesn't exist yet; we'll wait for it.
  }

  const readNewLines = (): void => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(currentPath);
    } catch {
      return; // File not ready yet.
    }

    if (stat.size < offset) {
      // File was truncated (unlikely for append-only JSONL, but handle it).
      offset = 0;
      partialLine = "";
    }

    if (stat.size === offset) {
      return;
    }

    const fd = fs.openSync(currentPath, "r");
    try {
      const len = stat.size - offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      offset = stat.size;

      const chunk = partialLine + buf.toString("utf-8");
      const lines = chunk.split(/\r?\n/);

      // Last element may be incomplete — save it for next read.
      partialLine = lines.pop() ?? "";

      for (const line of lines) {
        const msg = parseTranscriptLine(line) as TranscriptMessage | null;
        if (msg && shouldIncludeMessage(msg, opts)) {
          runtime.log(renderMessage(msg, { thinking: Boolean(opts.thinking) }, rich));
          runtime.log("");
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  };

  const checkForReset = async (): Promise<boolean> => {
    // Check if the session entry's sessionId has changed (indicates a reset).
    const store = loadSessionStore(storePath, { skipCache: true });
    const entry = store[sessionKey];
    if (!entry || entry.sessionId === currentSessionId) {
      return false;
    }

    // Session was reset — switch to the new transcript file.
    fs.unwatchFile(currentPath, readNewLines);

    const resetMsg = "--- conversation reset ---";
    runtime.log(rich ? theme.warn(resetMsg) : resetMsg);

    currentSessionId = entry.sessionId;
    const candidates = resolveSessionTranscriptCandidates(
      entry.sessionId,
      storePath,
      entry.sessionFile,
    );
    currentPath = candidates.find((p) => fs.existsSync(p)) ?? candidates[0];

    offset = 0;
    partialLine = "";

    await waitForFile(currentPath, runtime);
    fs.watchFile(currentPath, { interval: 300 }, readNewLines);
    readNewLines();
    return true;
  };

  await waitForFile(currentPath, runtime);

  fs.watchFile(currentPath, { interval: 300 }, readNewLines);

  // Do one initial read in case data arrived between the initial dump and watchFile.
  readNewLines();

  // Periodically check for session resets.
  const resetCheck = setInterval(async () => {
    if (stopped) {
      return;
    }
    try {
      await checkForReset();
    } catch {
      // Ignore transient errors reading the store.
    }
  }, 2000);

  runtime.log(info("Following transcript (Ctrl+C to stop)..."));

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      stopped = true;
      clearInterval(resetCheck);
      fs.unwatchFile(currentPath, readNewLines);
      resolve();
    });
  });
}

export async function transcriptCommand(
  sessionKey: string,
  opts: { store?: string; limit?: number; thinking?: boolean; system?: boolean; follow?: boolean },
  runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();
  const storePath = resolveStorePath(opts.store ?? cfg.session?.store);
  const store = loadSessionStore(storePath);

  const entry: SessionEntry | undefined = store[sessionKey];
  if (!entry) {
    const keys = Object.keys(store);
    runtime.error(`Session "${sessionKey}" not found.`);
    if (keys.length > 0) {
      runtime.error(`Available keys: ${keys.join(", ")}`);
    } else {
      runtime.error("No sessions found in store.");
    }
    runtime.exit(1);
    return;
  }

  const allMessages = readSessionMessages(entry.sessionId, storePath, entry.sessionFile);
  const filtered = allMessages.filter((m) => shouldIncludeMessage(m as TranscriptMessage, opts));
  const totalCount = filtered.length;

  const messages =
    opts.limit !== undefined && opts.limit > 0 ? filtered.slice(-opts.limit) : filtered;

  const rich = isRich();

  runtime.log(info(`Session: ${sessionKey}`));
  runtime.log(info(`Session ID: ${entry.sessionId}`));
  runtime.log(info(`Messages: ${totalCount}`));
  if (opts.limit !== undefined && opts.limit < totalCount) {
    runtime.log(info(`Showing last ${messages.length} of ${totalCount}`));
  }
  runtime.log("");

  for (const raw of messages) {
    const msg = raw as TranscriptMessage;
    runtime.log(renderMessage(msg, { thinking: Boolean(opts.thinking) }, rich));
    runtime.log("");
  }

  if (opts.follow) {
    const candidates = resolveSessionTranscriptCandidates(
      entry.sessionId,
      storePath,
      entry.sessionFile,
    );
    const filePath = candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
    if (!filePath) {
      runtime.error("Cannot resolve transcript file path for follow mode.");
      runtime.exit(1);
      return;
    }
    await followTranscript(sessionKey, storePath, filePath, entry.sessionId, opts, runtime);
  }
}
