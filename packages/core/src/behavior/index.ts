/**
 * NPC behavior barrel (Q4/D5, ADR-001).
 */
export type {
  Behavior,
  BehaviorContext,
  BehaviorDecision,
  BehaviorAction,
  WorldStateReader,
} from "./types.js";
export {
  RuleBasedBehavior,
  buildBehaviorFromConfig,
  type RuleBasedBehaviorConfig,
  idleDecision,
} from "./behavior.js";
