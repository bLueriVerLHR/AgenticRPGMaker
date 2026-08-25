/**
 * Typed event bus tests (ADR-001 — Observer / Pub-Sub).
 *
 * emit/on/off semantics, unsubscribe, listener counts, typed payloads, and
 * snapshot dispatch (handlers unsubscribing during emit are skipped).
 */
import { describe, expect, it } from "vitest";

import { TypedEventBus, type GameEventMap } from "../../src/index.js";

function makeBus(): TypedEventBus<GameEventMap> {
  return new TypedEventBus<GameEventMap>();
}

describe("typed event bus (ADR-001)", () => {
  it("delivers emitted payloads to subscribed handlers", () => {
    const bus = makeBus();
    const seen: string[] = [];
    bus.on("dialogue", (event) => seen.push(event.text));
    bus.emit("dialogue", { text: "Hello!", speakerId: "npc" });
    expect(seen).toEqual(["Hello!"]);
  });

  it("delivers to multiple handlers in subscription order", () => {
    const bus = makeBus();
    const order: string[] = [];
    bus.on("walk", () => order.push("first"));
    bus.on("walk", () => order.push("second"));
    bus.emit("walk", { entityId: "player", from: { x: 0, y: 0 }, to: { x: 0, y: 1 } });
    expect(order).toEqual(["first", "second"]);
  });

  it("off unsubscribes a handler", () => {
    const bus = makeBus();
    let count = 0;
    const handler = () => {
      count += 1;
    };
    bus.on("collide", handler);
    bus.off("collide", handler);
    bus.emit("collide", { entityId: "a", otherId: "b", blocked: true });
    expect(count).toBe(0);
  });

  it("unsubscribe function removes the handler", () => {
    const bus = makeBus();
    let count = 0;
    const unsubscribe = bus.on("sound", () => {
      count += 1;
    });
    bus.emit("sound", { ref: "a" });
    unsubscribe();
    bus.emit("sound", { ref: "b" });
    expect(count).toBe(1);
  });

  it("tracks listener counts per event type", () => {
    const bus = makeBus();
    expect(bus.listenerCount("dialogue")).toBe(0);
    const unsub1 = bus.on("dialogue", () => {});
    const unsub2 = bus.on("dialogue", () => {});
    expect(bus.listenerCount("dialogue")).toBe(2);
    unsub1();
    expect(bus.listenerCount("dialogue")).toBe(1);
    unsub2();
    expect(bus.listenerCount("dialogue")).toBe(0);
  });

  it("clear removes every handler", () => {
    const bus = makeBus();
    let count = 0;
    bus.on("walk", () => {
      count += 1;
    });
    bus.on("dialogue", () => {
      count += 1;
    });
    bus.clear();
    bus.emit("walk", { entityId: "p", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } });
    bus.emit("dialogue", { text: "hi" });
    expect(count).toBe(0);
  });

  it("skips handlers unsubscribed during the same emit (Node-style semantics)", () => {
    const bus = makeBus();
    const seen: string[] = [];
    let unsubscribeSecond: () => void = () => {};
    const first = () => {
      seen.push("first");
      unsubscribeSecond(); // remove the second handler mid-dispatch
    };
    const second = () => {
      seen.push("second");
    };
    bus.on("walk", first);
    unsubscribeSecond = bus.on("walk", second);
    bus.emit("walk", { entityId: "p", from: { x: 0, y: 0 }, to: { x: 0, y: 1 } });
    expect(seen).toEqual(["first"]);

    // After the emit the second handler is truly gone (first is still there).
    bus.emit("walk", { entityId: "p", from: { x: 0, y: 0 }, to: { x: 0, y: 1 } });
    expect(seen).toEqual(["first", "first"]);
  });

  it("is type-safe: different event names carry different payload types", () => {
    const bus = makeBus();
    const received: unknown[] = [];
    bus.on("switch_changed", (event) => received.push(event.value));
    bus.on("variable_changed", (event) => received.push(event.value));
    bus.emit("switch_changed", { name: "sw", value: true, previous: false });
    bus.emit("variable_changed", { name: "gold", value: 5, op: "add", previous: 0 });
    expect(received).toEqual([true, 5]);
  });

  it("emitting to an event with no listeners is a no-op", () => {
    const bus = makeBus();
    expect(() =>
      bus.emit("collide", { entityId: "a", otherId: "b", blocked: false }),
    ).not.toThrow();
  });
});
