/**
 * GameLoop + SceneManager tests (docs/06-architecture.md §3/§7).
 */
import { describe, expect, it } from "vitest";

import { GameLoop } from "../src/game-loop.js";
import { SceneManager } from "../src/scene.js";
import type { Scene, SceneContext } from "../src/scene.js";
import { createNoopLogger } from "../src/logger.js";

describe("GameLoop (fixed-step accumulator)", () => {
  it("runs update in fixed steps and renders once per frame", () => {
    const updates: number[] = [];
    const renders: number[] = [];
    const loop = new GameLoop({
      fixedDt: 1 / 60,
      raf: () => 1,
      cancelRaf: () => {},
      now: () => 0,
    });
    let t = 0;
    loop.start(
      (dt) => updates.push(dt),
      (alpha) => renders.push(alpha),
    );
    // The first tick anchors the clock (no step). Then each 100ms frame → 6 steps.
    for (let i = 0; i < 4; i++) {
      loop.tick(t);
      t += 100;
    }
    loop.stop();
    expect(updates).toHaveLength(18); // 3 frames × 6 steps
    expect(updates[0]).toBeCloseTo(1 / 60, 5);
    expect(renders).toHaveLength(3);
  });

  it("does not step when the loop is stopped", () => {
    const updates: number[] = [];
    const loop = new GameLoop({
      fixedDt: 1 / 60,
      maxFrameDt: 2, // allow the full 1s gap below
      raf: () => 1,
      cancelRaf: () => {},
      now: () => 0,
    });
    loop.tick(1000);
    expect(updates).toHaveLength(0);
    loop.start(
      (dt) => updates.push(dt),
      () => {},
    );
    loop.tick(2000); // anchors
    loop.tick(3000); // 1s → ~60 steps (float tolerance)
    expect(updates.length).toBeGreaterThanOrEqual(59);
    loop.stop();
    loop.tick(4000);
    const afterStop = updates.length;
    loop.tick(5000);
    expect(updates.length).toBe(afterStop); // no more after stop
  });

  it("clamps a single huge frame dt to maxFrameDt", () => {
    const updates: number[] = [];
    const loop = new GameLoop({
      fixedDt: 1 / 60,
      maxFrameDt: 0.25,
      raf: () => 1,
      cancelRaf: () => {},
      now: () => 0,
    });
    loop.start(
      (dt) => updates.push(dt),
      () => {},
    );
    loop.tick(0);
    loop.tick(5000); // 5s gap → clamped to 0.25 → 15 steps
    loop.stop();
    expect(updates.length).toBe(Math.round(0.25 / (1 / 60)));
  });

  it("provides an interpolation alpha between steps", () => {
    const alphas: number[] = [];
    const loop = new GameLoop({
      fixedDt: 1 / 60,
      raf: () => 1,
      cancelRaf: () => {},
      now: () => 0,
    });
    loop.start(
      () => {},
      (a) => alphas.push(a),
    );
    loop.tick(0);
    loop.tick(1); // 1ms after the anchor: 0 fixed steps, alpha = 0.06
    loop.stop();
    expect(alphas).toHaveLength(1);
    expect(alphas[0]).toBeGreaterThan(0);
    expect(alphas[0]).toBeLessThan(1);
  });

  it("can run with an injected now() clock", () => {
    let clock = 0;
    const loop = new GameLoop({
      fixedDt: 0.5,
      maxFrameDt: 2,
      raf: () => 1,
      cancelRaf: () => {},
      now: () => clock,
    });
    const updates: number[] = [];
    loop.start(
      (dt) => updates.push(dt),
      () => {},
    );
    clock = 1000;
    loop.tick(1000); // anchors
    clock = 2000;
    loop.tick(2000); // 1000ms / 500ms step → 2 steps
    loop.stop();
    expect(updates.length).toBe(2);
  });
});

describe("SceneManager (State pattern)", () => {
  const context: SceneContext = {
    bus: {} as never,
    state: {} as never,
    logger: createNoopLogger(),
  };

  function makeScene(id: string, log: string[]): Scene {
    return {
      id,
      enter() {
        log.push(`enter:${id}`);
      },
      update() {
        log.push(`update:${id}`);
      },
      render() {
        log.push(`render:${id}`);
      },
      exit() {
        log.push(`exit:${id}`);
      },
    };
  }

  it("enters the first scene and delegates update/render", () => {
    const log: string[] = [];
    const manager = new SceneManager(context, { logger: createNoopLogger() });
    expect(manager.current).toBeNull();
    manager.change(makeScene("map", log));
    expect(manager.current?.id).toBe("map");
    manager.update(0.1);
    manager.render(1);
    expect(log).toEqual(["enter:map", "update:map", "render:map"]);
  });

  it("exits the old scene before entering the new one", () => {
    const log: string[] = [];
    const manager = new SceneManager(context, { logger: createNoopLogger() });
    manager.change(makeScene("a", log));
    manager.change(makeScene("b", log));
    expect(log).toEqual(["enter:a", "exit:a", "enter:b"]);
    manager.update(0.1);
    expect(log).toEqual(["enter:a", "exit:a", "enter:b", "update:b"]);
  });

  it("ignores changing to the same scene", () => {
    const log: string[] = [];
    const manager = new SceneManager(context, { logger: createNoopLogger() });
    const scene = makeScene("a", log);
    manager.change(scene);
    manager.change(scene);
    expect(log).toEqual(["enter:a"]);
  });

  it("clear() exits the current scene", () => {
    const log: string[] = [];
    const manager = new SceneManager(context, { logger: createNoopLogger() });
    manager.change(makeScene("a", log));
    manager.clear();
    expect(manager.current).toBeNull();
    expect(log).toEqual(["enter:a", "exit:a"]);
  });
});
