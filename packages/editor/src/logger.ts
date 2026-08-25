/**
 * Editor structured logger (docs/06-architecture.md §8, 03-wal-process.md §2).
 *
 * A minimal structured (JSON) logger seam for the editor: every entry is a
 * structured object with a level, message, and optional data payload. Levels
 * mirror the runtime logger (trace/debug/info/warn/error); `info` is the
 * default operational level and `warn`/`error` are never suppressed.
 *
 * This is an *adaptation* of the runtime logger (packages/runtime/src/logger.ts)
 * kept local so the editor's logging does not depend on a built runtime bundle
 * in unit tests; the entry shape (`LogEntry`) is intentionally compatible so a
 * future remote sink can share the runtime's JSON convention.
 *
 * Secrets are never logged: any data key matching the sensitive-key pattern is
 * redacted before any sink sees it.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: readonly LogLevel[] = ["trace", "debug", "info", "warn", "error"];

/** One structured log entry (mirrors the web JSON convention). */
export interface LogEntry {
  ts: string;
  level: LogLevel;
  /** Logger scope, e.g. "editor.storage" or "editor.commands". */
  logger: string;
  msg: string;
  /** Optional structured payload (redacted before sinks). */
  data?: unknown;
}

export type LogSink = (entry: LogEntry) => void;

export interface EditorLoggerOptions {
  /** Explicit level; defaults to "info". */
  level?: LogLevel;
  /** Default scope prepended to child scopes. Default "editor". */
  scope?: string;
  /** Sinks to use. Defaults to a console sink. */
  sinks?: LogSink[];
  /** Redact sensitive data keys. Default true. */
  redact?: boolean;
}

const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|api[_-]?key|authorization|auth[_-]?header|session[_-]?secret/i;

const LEVEL_ORDER: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

function isLogLevel(value: string | null | undefined): value is LogLevel {
  return value !== undefined && value !== null && (LOG_LEVELS as readonly string[]).includes(value);
}

function resolveConfiguredLevel(option: LogLevel | undefined): LogLevel {
  if (option !== undefined && isLogLevel(option)) {
    return option;
  }
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem("agenticrpg.editor.logLevel");
    if (isLogLevel(stored)) {
      return stored;
    }
  }
  return "info";
}

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
export function createConsoleSink(scope = "editor"): LogSink {
  return (entry: LogEntry) => {
    const line = formatLogEntry({ ...entry, logger: `${scope}.${entry.logger}` });
    switch (entry.level) {
      case "trace":
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

/** A structured logger for editor subsystems. */
export class EditorLogger {
  private readonly scope: string;
  private readonly sinks: LogSink[];
  private readonly redactEnabled: boolean;
  private levelValue: LogLevel;

  constructor(options: EditorLoggerOptions = {}) {
    this.scope = options.scope ?? "editor";
    this.redactEnabled = options.redact ?? true;
    this.levelValue = resolveConfiguredLevel(options.level);
    this.sinks = options.sinks ?? [createConsoleSink(this.scope)];
  }

  /** The logger's default scope. */
  get scopeName(): string {
    return this.scope;
  }

  /** The current effective level. */
  get level(): LogLevel {
    return this.levelValue;
  }

  /** Runtime level change (configurable, not hard-coded). */
  setLevel(level: LogLevel): void {
    if (!isLogLevel(level)) {
      this.warn("editor logger: ignoring invalid level", { level: String(level) });
      return;
    }
    this.levelValue = level;
  }

  /** A scoped logger: entries carry `<parentScope>.<childScope>`. */
  child(scope: string): EditorLogger {
    return new EditorLogger({
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

/** A logger that drops everything except errors (tests, hot paths). */
export function createNoopLogger(): EditorLogger {
  return new EditorLogger({ level: "error", sinks: [() => {}] });
}
