/**
 * Event interpreter barrel (ADR-001 / ADR-003).
 */
export { GameState, EMPTY_SNAPSHOT, type GameStateSnapshot } from "./game-state.js";
export {
  CompositeCommand,
  commandFromSchema,
  UnknownCommandError,
  type Command,
  type CommandContext,
  type GameEffect,
  type CommandPosition,
  ShowTextCommand,
  SetVariableCommand,
  SetSwitchCommand,
  PlaySoundCommand,
  WalkCommand,
  MoveCommand,
} from "./commands.js";
export {
  EventInterpreter,
  evaluateCondition,
  type InterpreterDeps,
  type RunEventOptions,
  type InterpretationResult,
} from "./interpreter.js";