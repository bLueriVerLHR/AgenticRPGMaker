/**
 * Gameplay event catalog (ADR-001).
 *
 * The typed payloads for the gameplay events the core emits: walk, collide,
 * dialogue, switch/variable changed, and the additive `sound` event used by the
 * `playSound` interpreter command. Position types are structurally compatible
 * with `entity.Vec2` (tile units) without importing it, keeping this module
 * standalone.
 */

/** A tile-space position (structurally compatible with `Vec2`). */
export interface TilePosition {
  x: number;
  y: number;
}

/** A character (player or NPC) walked one step. */
export interface WalkEvent {
  entityId: string;
  from: TilePosition;
  to: TilePosition;
}

/** A movement was blocked (or a trigger was entered) by another entity. */
export interface CollideEvent {
  entityId: string;
  otherId: string;
  /** True when the collider is solid (movement blocked). */
  blocked: boolean;
}

/** A `showText` command produced dialogue. */
export interface DialogueEvent {
  text: string;
  /** Entity that spoke, when known (e.g. the event's entity id). */
  speakerId?: string;
}

/** A switch changed value (emit on every change). */
export interface SwitchChangedEvent {
  name: string;
  value: boolean;
  previous: boolean;
}

/** A variable changed value (emit on every change). */
export interface VariableChangedEvent {
  name: string;
  value: number;
  op: "set" | "add";
  previous: number;
}

/** A `playSound` command requested playback (core never plays audio). */
export interface SoundEvent {
  /** Sound/audio asset reference, e.g. "audio/coin.ogg". */
  ref: string;
}

/**
 * The typed gameplay event map for this engine. Every key maps an event name to
 * its payload type; `TypedEventBus<GameEventMap>` then enforces at compile time
 * that `emit`/`on`/`off` agree on the payload for each event name.
 */
export interface GameEventMap {
  walk: WalkEvent;
  collide: CollideEvent;
  dialogue: DialogueEvent;
  switch_changed: SwitchChangedEvent;
  variable_changed: VariableChangedEvent;
  sound: SoundEvent;
}