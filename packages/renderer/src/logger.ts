/**
 * Minimal renderer logging seam (P1b).
 *
 * ADR-002 requires the chosen renderer backend to be logged at `info` so that
 * support issues are diagnosable from logs alone
 * (docs/06-architecture.md §8). The project-wide structured logger is owned by
 * `packages/runtime` (P1c); until that lands, this package defines its own tiny
 * injectable seam so backend code never hard-codes `console`. Upper layers may
 * pass any logger-shaped object; a console-backed default keeps the package
 * usable standalone (and lets CI/tests inject a recording logger).
 */

/** The slice of a logger the renderer consumes. */
export interface RendererLogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

const NOOP = (): void => {};

/** Logger that drops everything; used when no logger is injected. */
export const noopRendererLogger: RendererLogger = {
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

/**
 * Console-backed logger emitting structured-ish JSON entries, mirroring the
 * web logging rules in docs/06-architecture.md §8:
 * `{"logger":"renderer","level":"info","msg":"..."}`.
 */
export function createConsoleRendererLogger(scope = "renderer"): RendererLogger {
  const write =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string, meta?: unknown): void => {
      const entry = {
        logger: scope,
        level,
        msg: message,
        ...(meta === undefined ? {} : { meta }),
      };
      const line = JSON.stringify(entry);
      switch (level) {
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
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
  };
}

/** Default logger instance used when the factory is given none. */
export const defaultRendererLogger: RendererLogger = createConsoleRendererLogger();
