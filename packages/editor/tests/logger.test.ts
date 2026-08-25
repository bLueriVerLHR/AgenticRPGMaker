/**
 * Logger tests (docs/03-wal-process.md §2, docs/06-architecture.md §8).
 */
import { describe, expect, it } from "vitest";

import { EditorLogger, LOG_LEVELS, createConsoleSink, formatLogEntry } from "../src/logger.js";

describe("EditorLogger", () => {
  it("logs structured entries to sinks", () => {
    const entries: unknown[] = [];
    const logger = new EditorLogger({ level: "debug", sinks: [(entry) => entries.push(entry)] });
    logger.info("hello", { key: "value" });
    expect(entries).toHaveLength(1);
    const entry = entries[0] as {
      level: string;
      logger: string;
      msg: string;
      data: unknown;
      ts: string;
    };
    expect(entry.level).toBe("info");
    expect(entry.logger).toBe("editor");
    expect(entry.msg).toBe("hello");
    expect(entry.data).toEqual({ key: "value" });
    expect(new Date(entry.ts).getTime()).not.toBeNaN();
  });

  it("redacts sensitive keys before sinks", () => {
    const entries: unknown[] = [];
    const logger = new EditorLogger({ level: "info", sinks: [(entry) => entries.push(entry)] });
    logger.info("op", { password: "hunter2", ok: 1 });
    const entry = entries[0] as { data: { password: string; ok: number } };
    expect(entry.data.password).toBe("[REDACTED]");
    expect(entry.data.ok).toBe(1);
  });

  it("filters by level; warn/error are never suppressed", () => {
    const entries: unknown[] = [];
    const logger = new EditorLogger({ level: "info", sinks: [(entry) => entries.push(entry)] });
    logger.trace("trace");
    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");
    const messages = entries.map((e) => (e as { msg: string }).msg);
    expect(messages).toEqual(["info", "warn", "error"]);
  });

  it("child() scopes entries", () => {
    const entries: unknown[] = [];
    const logger = new EditorLogger({ level: "info", sinks: [(entry) => entries.push(entry)] });
    logger.child("storage").info("saved");
    expect((entries[0] as { logger: string }).logger).toBe("editor.storage");
  });

  it("setLevel changes the effective level at runtime", () => {
    const entries: unknown[] = [];
    const logger = new EditorLogger({ level: "error", sinks: [(entry) => entries.push(entry)] });
    logger.debug("hidden");
    logger.setLevel("debug");
    logger.debug("shown");
    expect(entries).toHaveLength(1);
    expect((entries[0] as { msg: string }).msg).toBe("shown");
  });

  it("LOG_LEVELS are ordered trace→error", () => {
    expect(LOG_LEVELS).toEqual(["trace", "debug", "info", "warn", "error"]);
  });

  it("formatLogEntry produces a single JSON line", () => {
    const line = formatLogEntry({ ts: "t", level: "info", logger: "x", msg: "m", data: { a: 1 } });
    expect(JSON.parse(line)).toEqual({
      ts: "t",
      level: "info",
      logger: "x",
      msg: "m",
      data: { a: 1 },
    });
  });

  it("createConsoleSink returns a sink function", () => {
    const sink = createConsoleSink("editor");
    expect(typeof sink).toBe("function");
  });
});
