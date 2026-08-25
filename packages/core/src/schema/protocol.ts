/**
 * Multiplayer protocol v1 (ADR-004).
 *
 * Every message is a JSON envelope that carries a protocol version field `v`
 * in EVERY message, a `type` naming the message, an optional per-connection
 * `seq`, and a `payload` object. The catalog below mirrors ADR-004; this
 * schema is the shared, normative definition consumed by the TS client and
 * test suites (the C++ server treats ADR-004 as its normative wire
 * description since it cannot import TS).
 */
import { z } from "zod";

import { SCHEMA_VERSIONS } from "../version.js";

export const PROTOCOL_SCHEMA_VERSION = SCHEMA_VERSIONS.protocol;

/** Message type catalog (ADR-004). Additive extension is allowed. */
export const PROTOCOL_MESSAGE_TYPES = [
  "hello",
  "welcome",
  "player_state",
  "chat",
  "leave",
  "ping",
  "pong",
  "error",
] as const;

export const protocolMessageTypeSchema = z.enum(PROTOCOL_MESSAGE_TYPES);

/** The envelope — present in EVERY message (both directions). */
export const protocolEnvelopeSchema = z.object({
  /** Protocol version. `1` = v1. */
  v: z.literal(PROTOCOL_SCHEMA_VERSION),
  /** One of the message catalog names (or a future additive type). */
  type: z.string().min(1),
  /** Per-connection monotonically increasing sequence (optional). */
  seq: z.number().int().nonnegative().optional(),
  /** Message-specific body, defined per type below. */
  payload: z.record(z.string(), z.unknown()),
});

/** Player position/state (tile units in v1). */
export const playerStateSchema = z.object({
  x: z.number(),
  y: z.number(),
  direction: z.enum(["up", "down", "left", "right"]),
  /** Animation token from the shared catalog, e.g. "idle", "walk". */
  animation: z.string().optional(),
});

/** `hello` (C->S) — join a room; must be the first message of a connection. */
export const helloPayloadSchema = z.object({
  playerName: z.string().min(1),
  roomId: z.string().min(1),
  projectId: z.string().optional(),
});

/** `welcome` (S->C) — room info + current players, including the joiner. */
export const welcomePlayerSchema = z.object({
  sessionId: z.string().min(1),
  playerName: z.string(),
  state: playerStateSchema,
});
export const welcomePayloadSchema = z.object({
  sessionId: z.string().min(1),
  roomId: z.string().min(1),
  projectId: z.string().optional(),
  serverTimeMs: z.number(),
  players: z.array(welcomePlayerSchema),
});

/** `player_state` (C->S) — client update; (S->C) — broadcast to the others. */
export const playerStatePayloadSchema = z.object({
  state: playerStateSchema,
  clientTimeMs: z.number().optional(),
  sessionId: z.string().optional(),
  serverTimeMs: z.number().optional(),
});

/** `chat` (C->S, S->C) — rate-limited text (200 chars max in v1). */
export const chatPayloadSchema = z.object({
  text: z.string().max(200),
  sessionId: z.string().optional(),
  playerName: z.string().optional(),
  serverTimeMs: z.number().optional(),
});

/** `leave` (C->S, S->C) — client leaves / server notifies the others. */
export const leavePayloadSchema = z.object({
  reason: z.string().optional(),
  sessionId: z.string().optional(),
  playerName: z.string().optional(),
});

/** `ping` (C->S) / `pong` (S->C) — heartbeat. */
export const heartbeatPayloadSchema = z.object({
  clientTimeMs: z.number().optional(),
  serverTimeMs: z.number().optional(),
});

/** Error codes for v1 (ADR-004). */
export const PROTOCOL_ERROR_CODES = [
  "protocol_version_mismatch",
  "malformed_message",
  "unknown_type",
  "protocol_error",
  "room_not_found",
  "room_full",
  "name_taken",
  "project_mismatch",
  "rate_limited",
  "internal_error",
] as const;

/** `error` (S->C) — protocol / version / rate-limit failures. */
export const errorPayloadSchema = z.object({
  code: z.enum(PROTOCOL_ERROR_CODES),
  message: z.string(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type ProtocolEnvelope = z.infer<typeof protocolEnvelopeSchema>;
export type ProtocolMessageType = z.infer<typeof protocolMessageTypeSchema>;
export type PlayerState = z.infer<typeof playerStateSchema>;
export type HelloPayload = z.infer<typeof helloPayloadSchema>;
export type WelcomePayload = z.infer<typeof welcomePayloadSchema>;
export type PlayerStatePayload = z.infer<typeof playerStatePayloadSchema>;
export type ChatPayload = z.infer<typeof chatPayloadSchema>;
export type LeavePayload = z.infer<typeof leavePayloadSchema>;
export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;
