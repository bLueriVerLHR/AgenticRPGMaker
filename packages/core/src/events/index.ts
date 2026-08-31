/**
 * Typed event bus barrel (ADR-001).
 */
export {
  TypedEventBus,
  type EventHandler,
  type Unsubscribe,
  type GameEventBus,
} from "./event-bus.js";
export {
  type GameEventMap,
  type TilePosition,
  type WalkEvent,
  type CollideEvent,
  type DialogueEvent,
  type SwitchChangedEvent,
  type VariableChangedEvent,
  type SoundEvent,
  type TransferDirection,
  type TransferEvent,
} from "./game-events.js";
