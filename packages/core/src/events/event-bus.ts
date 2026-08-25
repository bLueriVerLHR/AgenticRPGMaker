/**
 * Typed event bus (ADR-001 — Observer / Pub-Sub).
 *
 * Engine subsystems and components publish/subscribe through a central bus with
 * **typed event names**: `emit`/`on`/`off` are type-checked against the event
 * map, so a handler for `walk` cannot accidentally receive a `dialogue`
 * payload. The bus is synchronous (same-tick delivery), deterministic, and
 * runs identically in Node (tests) and the browser.
 */
import type { GameEventMap } from "./game-events.js";

/** Handler receiving a typed event payload. */
export type EventHandler<P> = (payload: P) => void;

/** Function returned by `on`; calling it unsubscribes the handler. */
export type Unsubscribe = () => void;

/**
 * A typed pub/sub bus over an event map `M` (event name -> payload type).
 */
export class TypedEventBus<M extends object> {
  private readonly handlers = new Map<keyof M, Set<EventHandler<unknown>>>();

  /**
   * Subscribes a handler to `type`. Returns an unsubscribe function.
   * Multiple subscriptions of the same handler are idempotent.
   */
  on<K extends keyof M>(type: K, handler: EventHandler<M[K]>): Unsubscribe {
    let set = this.handlers.get(type);
    if (set === undefined) {
      set = new Set<EventHandler<unknown>>();
      this.handlers.set(type, set);
    }
    set.add(handler as EventHandler<unknown>);
    return () => {
      this.off(type, handler);
    };
  }

  /** Unsubscribes a handler from `type` (no-op when absent). */
  off<K extends keyof M>(type: K, handler: EventHandler<M[K]>): void {
    const set = this.handlers.get(type);
    if (set === undefined) {
      return;
    }
    set.delete(handler as EventHandler<unknown>);
    if (set.size === 0) {
      this.handlers.delete(type);
    }
  }

  /**
   * Emits a payload to all handlers of `type`, synchronously, in subscription
   * order. Handlers that are unsubscribed *during* the emission (by an earlier
   * handler) are skipped for the rest of the current dispatch — the same
   * semantics as Node.js EventEmitter.
   */
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (set === undefined || set.size === 0) {
      return;
    }
    const snapshot = [...set];
    for (const handler of snapshot) {
      // Skip handlers removed mid-dispatch.
      if (set.has(handler)) {
        (handler as EventHandler<M[K]>)(payload);
      }
    }
  }

  /** Removes every handler (useful for scene teardown). */
  clear(): void {
    this.handlers.clear();
  }

  /** Number of handlers currently subscribed to `type`. */
  listenerCount<K extends keyof M>(type: K): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}

/** The engine's gameplay bus: typed over the gameplay event catalog. */
export type GameEventBus = TypedEventBus<GameEventMap>;
