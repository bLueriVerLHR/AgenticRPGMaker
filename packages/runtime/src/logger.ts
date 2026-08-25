/**
 * Structured JSON logger (P1c, docs/06-architecture.md §8).
 *
 * The web-side logging seam: every entry is a structured JSON object with a
 * level, message, and optional data payload. Levels mirror the C++ side
 * (trace/debug/info/warn/error); `info` is the default operational level,
 * `warn`/`error` are always on. The level is runtime-configurable (explicit
 * option, then `localStorage["agenticrpg.logLevel"]`, then
 * `window.AGENTICRPG_LOG_LEVEL`, then the default `info`) and can be changed
 * at any time with `setLevel`.
 *
 * Two sink seams are provided:
 * - a debug **console sink** that writes a single JSON line per entry;
 * - a **remote sink** seam (`setRemoteSink` / `remoteSink` option) that
 *   forwards entries to a callback — the actual network forwarder is wired
 *   later; the seam is kept so the runtime never hard-codes its transport.
 *
 * Secrets are never logged: any data key whose name matches the sensitive-key
 * pattern is redacted to `"[REDACTED]"` before any sink sees it. `warn` and
 * `error` are never suppressed by the level filter.
 */

/** Log levels, ordered most-verbose to least-verbose. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: readonly LogLevel[] = ["trace", "debug", "info", "warn", "error"];

/** One structured log entry (mirrors 03-wal-process.md §2 JSON convention). */
export interface LogEntry {
  /** ISO-8601 timestamp of the entry. */
  ts: string;
  level: LogLevel;
  /** Logger scope, e.g. "runtime.boot" or "runtime.network". */
  logger: string;
  msg: string;
  /** Optional structured payload (redacted before sinks). */
  data?: unknown;
}

/** A log sink receives fully-formed, already-redacted entries. */
export type LogSink = (entry: LogEntry) => void;

export interface LoggerOptions {
  /** Explicit level; overrides env/config sources. Default resolves to "info". */
  level?: LogLevel;
  /** Default scope prepended to child scopes. Default "runtime". */
  scope?: string;
  /** Sinks to use. Defaults to a console sink. */
  sinks?: LogSink[];
  /** Remote-sink seam: forwarded every entry (adds to `sinks`). */
  remoteSink?: LogSink;
  /** Redact sensitive data keys. Default true. */
  redact?: boolean;
}

/** The subset of the DOM the logger reads for runtime config (guarded). */
interface LoggerEnv {
  localStorage?: Pick<Storage, "getItem">;
  windowLevel?: string;
}

/** Key names never logged, whatever their value (docs §8 "never log secrets"). */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|api[_-]?key|authorization|auth[_-]?header|session[_-]?secret/i;

/** Relative severity order; higher = more severe. */
const LEVEL_ORDER: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

function isLogLevel(value: string | null | undefined): value is LogLevel {
  return value !== undefined && value !== null && (LOG_LEVELS as readonly string[]).includes(value);
}

/** Resolve the configured level from explicit option then env (guarded). */
function resolveConfiguredLevel(option: LogLevel | undefined, env: LoggerEnv): LogLevel {
  if (option !== undefined && isLogLevel(option)) {
    return option;
  }
  const stored = env.localStorage?.getItem("agenticrpg.logLevel");
  if (isLogLevel(stored)) {
    return stored;
  }
  if (isLogLevel(env.windowLevel)) {
    return env.windowLevel;
  }
  return "info";
}

/** Walks a value and returns a copy with sensitive keys redacted. */
function redact(value: unknown, seen: Set<unknown>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(item, seen);
    }
    seen.delete(value);
    return out;
  }
  return value;
}

/** Serialize an entry as a single-line JSON string (no secrets leak). */
export function formatLogEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/** A console sink: one JSON line per entry at the matching console level. */
export function createConsoleSink(scope = "runtime"): LogSink {
  return (entry: LogEntry) => {
    const line = formatLogEntry({ ...entry, logger: `${scope}.${entry.logger}` });
    switch (entry.level) {
      case "trace":
        console.debug(line);
        break;
      case "debug":
        console.debug(line);
        break;
      case "info":
        console.info(line);
        break;
      case "warn":
        console.warn(line);
        break;
      case "error":
        console.error(line);
        break;
    }
  };
}

/** The never-emit sink used as a placeholder when no sink is configured. */
const noopSink: LogSink = () => {};

/**
 * A structured logger. Instances are cheap; create one per subsystem via
 * `logger.child(scope)` to get scoped entries.
 */
export class Logger {
  private readonly scope: string;
  private readonly sinks: LogSink[];
  private readonly redactEnabled: boolean;
  private levelValue: LogLevel;

  constructor(options: LoggerOptions = {}) {
    this.scope = options.scope ?? "runtime";
    this.redactEnabled = options.redact ?? true;
    this.levelValue = resolveConfiguredLevel(options.level, readLoggerEnv());

    const configuredSinks = options.sinks ?? [createConsoleSink(this.scope)];
    this.sinks =
      options.remoteSink === undefined ? configuredSinks : [...configuredSinks, options.remoteSink];
  }

  /** The logger's default scope. */
  get scopeName(): string {
    return this.scope;
  }

  /** The current effective level. */
  get level(): LogLevel {
    return this.levelValue;
  }

  /** Runtime level change (docs: configurable, not hard-coded). */
  setLevel(level: LogLevel): void {
    if (!isLogLevel(level)) {
      this.warn("logger: ignoring invalid level", { level: String(level) });
      return;
    }
    this.levelValue = level;
  }

  /** Set (or clear, with `null`) the remote sink seam. */
  setRemoteSink(sink: LogSink | null): void {
    this.sinks.length = 0;
    if (sink !== null) {
      this.sinks.push(sink);
    }
  }

  /** A scoped logger: entries carry `<parentScope>.<childScope>`. */
  child(scope: string): Logger {
    return new Logger({
      level: this.levelValue,
      scope: `${this.scope}.${scope}`,
      sinks: this.sinks,
      redact: this.redactEnabled,
    });
  }

  /** Core emit: filters by level, redacts, then fans out to every sink. */
  log(level: LogLevel, message: string, data?: unknown): void {
    if (
      LEVEL_ORDER[level] < LEVEL_ORDER[this.levelValue] &&
      level !== "warn" &&
      level !== "error"
    ) {
      return;
    }
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      logger: this.scope,
      msg: message,
    };
    if (data !== undefined) {
      entry.data = this.redactEnabled ? redact(data, new Set()) : data;
    }
    for (const sink of this.sinks) {
      sink(entry);
    }
  }

  trace(message: string, data?: unknown): void {
    this.log("trace", message, data);
  }

  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }
}

/** A logger that drops everything (tests, hot paths). */
export function createNoopLogger(): Logger {
  return new Logger({ level: "error", sinks: [noopSink] });
}

/** Read the runtime-configurable sources without touching undefined DOM. */
function readLoggerEnv(): LoggerEnv {
  const env: LoggerEnv = {};
  if (typeof localStorage !== "undefined") {
    env.localStorage = localStorage;
  }
  if (typeof window !== "undefined") {
    env.windowLevel = (window as { AGENTICRPG_LOG_LEVEL?: string }).AGENTICRPG_LOG_LEVEL;
  }
  return env;
}

/** The shared runtime logger (singleton for library default use). */
export const defaultLogger: Logger = new Logger();
