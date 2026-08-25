/**
 * NPC Behavior interface + rule-based strategy tests (Q4/D5, ADR-001).
 *
 * The Behavior seam is pluggable (Strategy pattern); the rule-based
 * implementation patrols waypoints deterministically, idles at each waypoint,
 * and reacts to a trigger switch. Behaviors are driven via the entity's
 * BehaviorComponent.
 */
import { describe, expect, it } from "vitest";

import {
  BehaviorComponent,
  GameObject,
  GameState,
  RuleBasedBehavior,
  SceneGraph,
  Transform,
  TypedEventBus,
  type BehaviorContext,
} from "../../src/index.js";

/** Applies a move decision to the entity's transform (what the runtime does). */
function applyDecision(entity: GameObject, decision: { dx?: number; dy?: number }): void {
  const transform = entity.getComponent("transform");
  if (transform !== null && decision.dx !== undefined && decision.dy !== undefined) {
    transform.translate(decision.dx, decision.dy);
  }
}

function makeContext(
  entity: GameObject,
  state: GameState,
  dt: number,
  elapsed: number,
): BehaviorContext {
  return {
    entity,
    bus: new TypedEventBus(),
    state,
    dt,
    elapsed,
  };
}

describe("Behavior interface (Strategy seam, Q4/D5)", () => {
  it("is hosted by BehaviorComponent and returns decisions each tick", () => {
    const npc = new GameObject({ id: "npc" });
    npc.addComponent(new Transform({ x: 0, y: 0 }));
    npc.addComponent(new BehaviorComponent());
    const component = npc.getComponent("behavior");
    expect(component).not.toBeNull();

    const behavior = new RuleBasedBehavior({ waypoints: [{ x: 1, y: 0 }], speed: 1 });
    component?.setBehavior(behavior);
    expect(component?.behavior?.id).toBe("rule-based");

    const decision = component?.update(makeContext(npc, new GameState(), 1, 0));
    expect(decision?.action).toBe("move");
  });

  it("is satisfied by any object implementing the interface (pluggable)", () => {
    // An LLM-style strategy would implement the same interface — here a stub
    // proves the seam is structural, not tied to RuleBasedBehavior.
    const state = new GameState({ variables: {}, switches: { sw_aggressive: true } });

    let calls = 0;
    const customStrategy = {
      id: "custom-stub",
      update: (ctx: BehaviorContext) => {
        calls += 1;
        expect(ctx.state.getSwitch("sw_aggressive")).toBe(true);
        expect(ctx.entity.id).toBe("npc");
        return { action: "say", text: "rawr" } as const;
      },
    };

    const npc = new GameObject({ id: "npc" });
    npc.addComponent(new Transform());
    npc.addComponent(new BehaviorComponent());
    const component = npc.getComponent("behavior");
    component?.setBehavior(customStrategy);
    const decision = component?.update(makeContext(npc, state, 1, 0));
    expect(calls).toBe(1);
    expect(decision?.action).toBe("say");
    expect((decision as { text?: string } | undefined)?.text).toBe("rawr");
  });
});

describe("RuleBasedBehavior (patrol / idle / triggers)", () => {
  it("moves toward the first waypoint from a different start", () => {
    const npc = new GameObject({ id: "npc" });
    npc.addComponent(new Transform({ x: 0, y: 0 }));
    const behavior = new RuleBasedBehavior({
      waypoints: [{ x: 2, y: 0 }],
      speed: 1,
      idleSeconds: 0,
    });

    let elapsed = 0;
    for (let i = 0; i < 4; i += 1) {
      elapsed += 0.5;
      const decision = behavior.update(makeContext(npc, new GameState(), 0.5, elapsed));
      applyDecision(npc, decision);
      if (decision.action !== "move") break;
    }
    // Arrived at waypoint (2,0).
    expect(npc.getComponent("transform")?.position).toEqual({ x: 2, y: 0 });
  });

  it("patrols around waypoints, idling at each", () => {
    const npc = new GameObject({ id: "npc" });
    npc.addComponent(new Transform({ x: 0, y: 0 }));
    const behavior = new RuleBasedBehavior({
      waypoints: [
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      speed: 10,
      idleSeconds: 1,
    });

    const decisions: string[] = [];
    let elapsed = 0;
    for (let tick = 0; tick < 10; tick += 1) {
      elapsed += 0.5;
      const decision = behavior.update(makeContext(npc, new GameState(), 0.5, elapsed));
      decisions.push(decision.action);
      applyDecision(npc, decision);
    }

    expect(decisions[0]).toBe("move"); // toward (1,0)
    // After arriving, idle pause begins; eventually another move toward (1,1).
    expect(decisions.filter((d) => d === "idle").length).toBeGreaterThan(0);
    expect(decisions.filter((d) => d === "move").length).toBeGreaterThan(1);
  });

  it("stops patrolling and faces when the trigger switch is set", () => {
    const npc = new GameObject({ id: "npc" });
    npc.addComponent(new Transform({ x: 0, y: 0 }));
    const state = new GameState({ variables: {}, switches: { sw_met: true } });
    const behavior = new RuleBasedBehavior({
      waypoints: [{ x: 5, y: 0 }],
      triggerSwitch: "sw_met",
      faceDirection: "up",
    });

    const decision = behavior.update(makeContext(npc, state, 1, 0));
    expect(decision.action).toBe("idle");
    expect(decision.direction).toBe("up");
  });

  it("patrols normally while the trigger switch is unset", () => {
    const npc = new GameObject({ id: "npc" });
    npc.addComponent(new Transform({ x: 0, y: 0 }));
    const state = new GameState({ variables: {}, switches: {} });
    const behavior = new RuleBasedBehavior({
      waypoints: [{ x: 5, y: 0 }],
      triggerSwitch: "sw_met",
      faceDirection: "up",
    });

    const decision = behavior.update(makeContext(npc, state, 1, 0));
    expect(decision.action).toBe("move");
  });

  it("returns idle for an entity already at a single waypoint", () => {
    const npc = new GameObject({ id: "npc" });
    npc.addComponent(new Transform({ x: 4, y: 4 }));
    const behavior = new RuleBasedBehavior({ waypoints: [{ x: 4, y: 4 }] });
    const decision = behavior.update(makeContext(npc, new GameState(), 1, 0));
    expect(decision.action).toBe("idle");
  });

  it("requires at least one waypoint", () => {
    expect(() => new RuleBasedBehavior({ waypoints: [] })).toThrow(/at least one waypoint/);
  });

  it("is deterministic: identical tick sequences produce identical positions", () => {
    const run = () => {
      const npc = new GameObject({ id: "npc" });
      npc.addComponent(new Transform({ x: 0, y: 0 }));
      const behavior = new RuleBasedBehavior({
        waypoints: [
          { x: 2, y: 0 },
          { x: 2, y: 2 },
        ],
        speed: 1,
        idleSeconds: 0.5,
      });
      let elapsed = 0;
      for (let tick = 0; tick < 8; tick += 1) {
        elapsed += 0.25;
        applyDecision(npc, behavior.update(makeContext(npc, new GameState(), 0.25, elapsed)));
      }
      const t = npc.getComponent("transform");
      return `${t?.x},${t?.y}`;
    };
    const a = run();
    const b = run();
    expect(a).toBe(b);
  });
});

describe("rule-based behavior in a scene (integration)", () => {
  it("drives a map event entity through the BehaviorComponent", () => {
    const scene = new SceneGraph();
    const npc = new GameObject({ id: "npc_guard" });
    npc.addComponent(new Transform({ x: 0, y: 0 }));
    npc.addComponent(new BehaviorComponent());
    scene.addEntity(npc);

    const state = new GameState();
    npc
      .getComponent("behavior")
      ?.setBehavior(
        new RuleBasedBehavior({ waypoints: [{ x: 3, y: 0 }], speed: 1, idleSeconds: 0 }),
      );

    let elapsed = 0;
    while (state.getVariable("guard_progress") < 3 && elapsed < 10) {
      elapsed += 1;
      const decision = npc.getComponent("behavior")?.update(makeContext(npc, state, 1, elapsed));
      applyDecision(npc, decision ?? {});
      state.setVariable("guard_progress", npc.getComponent("transform")?.x ?? 0);
    }
    expect(scene.getWorldPosition(npc).x).toBe(3);
  });
});
