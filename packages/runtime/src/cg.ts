/**
 * CG presentation script (ADR-010 §2/§6, S3b).
 *
 * The interpreter turns event pages into a deterministic `GameEffect` log
 * (core never renders). `buildCgScript` projects that log's presentation
 * subset into a timed, skippable `CgScript` the `CgScene` plays back:
 * dialogue lines, bgm/sfx cues, CG stills, fades, letterbox and the final
 * `end`. State-mutating effects (variable/switch) were already applied by
 * the interpreter in command order — the script only replays presentation.
 */

import type { GameEffect } from "@agenticrpg/core";

/** One presentation step of a CG (all steps advance except text/fades/still). */
export type CgStep =
  | { kind: "text"; text: string }
  | { kind: "bgm"; ref: string }
  | { kind: "sfx"; ref: string }
  | { kind: "cg"; image: string; mode: "cover" | "fit" }
  | { kind: "fadeOut"; color: string; durationMs: number }
  | { kind: "fadeIn"; durationMs: number }
  | { kind: "letterbox"; on: boolean }
  | { kind: "end" };

/** An ordered list of presentation steps. */
export type CgScript = readonly CgStep[];

/** Map an interpreter effect log to its presentation steps (in order). */
export function buildCgScript(effects: readonly GameEffect[]): CgStep[] {
  const steps: CgStep[] = [];
  for (const effect of effects) {
    switch (effect.kind) {
      case "dialogue":
        steps.push({ kind: "text", text: effect.text });
        break;
      case "sound":
        steps.push({ kind: "sfx", ref: effect.ref });
        break;
      case "bgm":
        steps.push({ kind: "bgm", ref: effect.ref });
        break;
      case "cg_show":
        steps.push({ kind: "cg", image: effect.image, mode: effect.mode });
        break;
      case "fade_out":
        steps.push({ kind: "fadeOut", color: effect.color, durationMs: effect.durationMs });
        break;
      case "fade_in":
        steps.push({ kind: "fadeIn", durationMs: effect.durationMs });
        break;
      case "letterbox":
        steps.push({ kind: "letterbox", on: effect.on });
        break;
      case "cg_end":
        steps.push({ kind: "end" });
        break;
      default:
        break; // walk/move/variable/switch are not presentation
    }
  }
  return steps;
}
