/**
 * Logger tests (docs/06-architecture.md §8 / 03-wal-process.md §2).
 */
import { describe, expect, it, vi } from "vitest";

import {
  createNoopLogger,
  createConsoleSink,
  formatLogEntry,
  Logger,
  LOG_LEVELS,
} from "../src/logger.js";
import type { LogEntry } from "../src/logger.js";

function collectSink(): { entries: LogEntry[]; sink: (entry: LogEntry) => void } {
  const entries: LogEntry[] = [];
  return { entries, sink: (entry) => entries.push(entry) };
}

describe("Logger (structured JSON)", () => {
  it("emits structured entries with level/logger/msg", () => {
    const { entries, sink } = collectSink();
    const logger = new Logger({ level: "trace", sinks: [sink] });
    logger.info("hello", { x: 1 });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.level).toBe("info");
    expect(entries[0]!.msg).toBe("hello");
    expect(entries[0]!.data).toEqual({ x: 1 });
    expect(typeof entries[0]!.ts).toBe("string");
  });

  it("filters by level (trace/debug hidden at info)", () => {
    const { entries, sink } = collectSink();
    const logger = new Logger({ level: "info", sinks: [sink] });
    logger.trace("t");
    logger.debug("d");
    logger.info("i");
    expect(entries.map((e) => e.msg)).toEqual(["i"]);
  });

  it("never suppresses warn/error even at a higher level", () => {
    const { entries, sink } = collectSink();
    const logger = new Logger({ level: "error", sinks: [sink] });
    logger.warn("w");
    logger.error("e");
    expect(entries.map((e) => e.msg)).toEqual(["w", "e"]);
  });

  it("supports runtime level changes", () => {
    const { entries, sink } = collectSink();
    const logger = new Logger({ level: "warn", sinks: [sink] });
    logger.debug("hidden");
    logger.setLevel("debug");
    logger.debug("shown");
    expect(entries.map((e) => e.msg)).toEqual(["shown"]);
  });

  it("redacts secret-looking keys", () => {
    const { entries, sink } = collectSink();
    const logger = new Logger({ level: "info", sinks: [sink] });
    logger.info("login", { username: "aria", password: "hunter2", token: "abc" });
    const data = entries[0]!.data as Record<string, unknown>;
    expect(data.username).toBe("aria");
    expect(data.password).toBe("[REDACTED]");
    expect(data.token).toBe("[REDACTED]");
  });

  it("forwards every entry to the remote sink seam", () => {
    const { entries, sink } = collectSink();
    const logger = new Logger({ level: "info", remoteSink: sink, sinks: [] });
    logger.info("forwarded", { a: 1 });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.msg).toBe("forwarded");
  });

  it("creates scoped child loggers", () => {
    const { entries, sink } = collectSink();
    const logger = new Logger({ level: "info", sinks: [sink], scope: "runtime" });
    logger.child("boot").info("booted");
    expect(entries[0]!.logger).toBe("runtime.boot");
  });

  it("is runtime-configurable via the explicit level option", () => {
    const { entries, sink } = collectSink();
    const logger = new Logger({ level: "error", sinks: [sink] });
    logger.info("no");
    expect(entries).toHaveLength(0);
  });
});

describe("logger utilities", () => {
  it("has the five documented levels in order", () => {
    expect(LOG_LEVELS).toEqual(["trace", "debug", "info", "warn", "error"]);
  });

  it("formats an entry as a single-line JSON string", () => {
    const line = formatLogEntry({
      ts: "t",
      level: "info",
      logger: "runtime",
      msg: "m",
      data: { a: 1 },
    });
    expect(JSON.parse(line)).toMatchObject({ level: "info", logger: "runtime", msg: "m" });
  });

  it("console sink writes one JSON line per entry (captured)", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      createConsoleSink()({ ts: "t", level: "info", logger: "runtime", msg: "hi" });
      expect(spy).toHaveBeenCalledTimes(1);
      const line = spy.mock.calls[0]![0] as string;
      expect(JSON.parse(line).msg).toBe("hi");
    } finally {
      spy.mockRestore();
    }
  });

  it("noop logger never emits", () => {
    const logger = createNoopLogger();
    expect(() => logger.error("boom")).not.toThrow();
  });
});
