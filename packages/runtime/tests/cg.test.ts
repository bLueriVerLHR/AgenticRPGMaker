/**
 * CG script builder tests (ADR-010 §6, S3b).
 *
 * `buildCgScript` projects the interpreter's effect log to presentation
 * steps: dialogue→text (dialogue during a CG), sound→sfx, cg_show→cg,
 * fades, letterbox, bgm, cg_end→end; state effects are skipped (already
 * applied by the interpreter).
 */
import { describe, expect, it } from "vitest";

import type { GameEffect } from "@agenticrpg/core";
import { buildCgScript } from "../src/cg.js";

function effect(kind: string, extra: Record<string, unknown> = {}): GameEffect {
  return { kind, ...extra } as unknown as GameEffect;
}

describe("buildCgScript", () => {
  it("maps the opening-CG effect log into ordered presentation steps", () => {
    const effects: GameEffect[] = [
      effect("bgm", { ref: "title" }),
      effect("fade_out", { color: "#000000", durationMs: 400 }),
      effect("cg_show", { image: "img/cg/opening.png", mode: "cover" }),
      effect("fade_in", { durationMs: 600 }),
      effect("letterbox", { on: true }),
      effect("dialogue", { text: "The beacon has gone dark." }),
      effect("dialogue", { text: "Take this sword." }),
      effect("letterbox", { on: false }),
      effect("sound", { ref: "save" }),
      effect("cg_end"),
    ];
    expect(buildCgScript(effects)).toEqual([
      { kind: "bgm", ref: "title" },
      { kind: "fadeOut", color: "#000000", durationMs: 400 },
      { kind: "cg", image: "img/cg/opening.png", mode: "cover" },
      { kind: "fadeIn", durationMs: 600 },
      { kind: "letterbox", on: true },
      { kind: "text", text: "The beacon has gone dark." },
      { kind: "text", text: "Take this sword." },
      { kind: "letterbox", on: false },
      { kind: "sfx", ref: "save" },
      { kind: "end" },
    ]);
  });

  it("skips state-mutating effects (walk/move/variable/switch)", () => {
    const effects: GameEffect[] = [
      effect("variable", { name: "gold", op: "add", value: 10, result: 10 }),
      effect("switch", { name: "sw_a", value: true }),
      effect("dialogue", { text: "only the line plays" }),
      effect("walk", { entityId: "player", from: { x: 0, y: 0 }, to: { x: 0, y: 1 } }),
      effect("move", { entityId: "npc", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }),
      effect("cg_end"),
    ];
    expect(buildCgScript(effects)).toEqual([
      { kind: "text", text: "only the line plays" },
      { kind: "end" },
    ]);
  });

  it("returns an empty script for an empty log", () => {
    expect(buildCgScript([])).toEqual([]);
  });
});
