/**
 * Protocol v1 helpers (ADR-004).
 *
 * Encode/decode helpers for the versioned JSON envelope `{v, type, seq?,
 * payload}`, plus typed constructors for every payload in the v1 catalog
 * (hello / welcome / player_state / chat / leave / ping / pong / error). The
 * schemas live in `schema/protocol.ts` (P0) and are reused verbatim — this
 * module adds the runtime encoding/decoding, the **version gate** (rejecting
 * mismatched `v`), and the message constructors.
 */
import type { z } from "zod";

import { PROTOCOL_VERSION } from "../version.js";
import {
  chatPayloadSchema,
  errorPayloadSchema,
  heartbeatPayloadSchema,
  helloPayloadSchema,
  leavePayloadSchema,
  playerStatePayloadSchema,
  protocolEnvelopeSchema,
  welcomePayloadSchema,
} from "../schema/index.js";
import type {
  ChatPayload,
  ErrorPayload,
  HeartbeatPayload,
  HelloPayload,
  LeavePayload,
  PlayerStatePayload,
  ProtocolEnvelope,
  WelcomePayload,
} from "../schema/index.js";

/** The protocol version this build speaks (ADR-004). */
export const PROTOCOL_V1 = PROTOCOL_VERSION;

/** Error code used when a peer's `v` field mismatches (ADR-004). */
export const PROTOCOL_ERROR_VERSION_MISMATCH = "protocol_version_mismatch";

/** Error code used when a message cannot be parsed/validated (ADR-004). */
export const PROTOCOL_ERROR_MALFORMED = "malformed_message";

/** Thrown when a message carries a `v` different from the supported one. */
export class ProtocolVersionMismatchError extends Error {
  readonly code: string = PROTOCOL_ERROR_VERSION_MISMATCH;
  readonly clientVersion: number;
  readonly serverVersion: number;

  constructor(clientVersion: number, serverVersion: number = PROTOCOL_VERSION) {
    super(
      `protocol version mismatch: client sent v${clientVersion}, server speaks v${serverVersion}`,
    );
    this.name = "ProtocolVersionMismatchError";
    this.clientVersion = clientVersion;
    this.serverVersion = serverVersion;
  }
}

/** Thrown when a message is not valid JSON or fails envelope validation. */
export class ProtocolDecodeError extends Error {
  readonly code: string = PROTOCOL_ERROR_MALFORMED;

  constructor(message: string) {
    super(message);
    this.name = "ProtocolDecodeError";
  }
}

/**
 * Version gate: throws `ProtocolVersionMismatchError` when `v` is not the
 * supported protocol version, or `ProtocolDecodeError` when it is missing.
 */
export function assertProtocolVersion(v: unknown): asserts v is number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new ProtocolDecodeError(
      `protocol version field "v" must be an integer, got ${String(v)}`,
    );
  }
  if (v !== PROTOCOL_VERSION) {
    throw new ProtocolVersionMismatchError(v, PROTOCOL_VERSION);
  }
}

/** Validates a message object against the envelope schema. */
export function validateMessage(input: unknown): ProtocolEnvelope {
  return protocolEnvelopeSchema.parse(input) as ProtocolEnvelope;
}

/** Serializes an envelope to its JSON wire form (validated). */
export function encodeMessage(message: ProtocolEnvelope): string {
  return JSON.stringify(validateMessage(message));
}

/** Deserializes a wire string into a validated envelope (with version gate). */
export function decodeMessage(raw: string): ProtocolEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProtocolDecodeError("message is not valid JSON");
  }
  return decodeMessageValue(parsed);
}

/** Validates a parsed JSON value as an envelope (with version gate). */
export function decodeMessageValue(input: unknown): ProtocolEnvelope {
  if (typeof input !== "object" || input === null) {
    throw new ProtocolDecodeError("message must be a JSON object");
  }
  assertProtocolVersion((input as Record<string, unknown>).v);
  return validateMessage(input);
}

/** Result of a non-throwing decode. */
export type DecodeResult = { ok: true; message: ProtocolEnvelope } | { ok: false; error: Error };

/** Non-throwing `decodeMessage` for edge handlers. */
export function decodeMessageSafe(raw: string): DecodeResult {
  try {
    return { ok: true, message: decodeMessage(raw) };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

/** Builds a validated envelope from a type name, payload, and optional seq. */
export function makeEnvelope(
  type: string,
  payload: Record<string, unknown>,
  seq?: number,
): ProtocolEnvelope {
  return validateMessage({ v: PROTOCOL_VERSION, type, seq, payload });
}

/** Validates a payload against a payload schema, then wraps it in an envelope. */
function buildEnvelope<S extends z.ZodType>(
  type: string,
  payload: unknown,
  schema: S,
  seq?: number,
): ProtocolEnvelope {
  const validated = schema.parse(payload);
  return makeEnvelope(type, validated as Record<string, unknown>, seq);
}

/** `hello` (C→S) — join a room; must be the first message of a connection. */
export function hello(payload: HelloPayload, seq?: number): ProtocolEnvelope {
  return buildEnvelope("hello", payload, helloPayloadSchema, seq);
}

/** `welcome` (S→C) — room info + current players, including the joiner. */
export function welcome(payload: WelcomePayload, seq?: number): ProtocolEnvelope {
  return buildEnvelope("welcome", payload, welcomePayloadSchema, seq);
}

/** `player_state` (C→S / S→C) — position/direction/animation update. */
export function playerState(payload: PlayerStatePayload, seq?: number): ProtocolEnvelope {
  return buildEnvelope("player_state", payload, playerStatePayloadSchema, seq);
}

/** `chat` (C→S / S→C) — rate-limited chat text. */
export function chat(payload: ChatPayload, seq?: number): ProtocolEnvelope {
  return buildEnvelope("chat", payload, chatPayloadSchema, seq);
}

/** `leave` (C→S / S→C) — client leaves / server notifies the others. */
export function leave(payload: LeavePayload, seq?: number): ProtocolEnvelope {
  return buildEnvelope("leave", payload, leavePayloadSchema, seq);
}

/** `ping` (C→S) — heartbeat request. */
export function ping(payload: HeartbeatPayload, seq?: number): ProtocolEnvelope {
  return buildEnvelope("ping", payload, heartbeatPayloadSchema, seq);
}

/** `pong` (S→C) — heartbeat reply echoing the client timestamp. */
export function pong(payload: HeartbeatPayload, seq?: number): ProtocolEnvelope {
  return buildEnvelope("pong", payload, heartbeatPayloadSchema, seq);
}

/** `error` (S→C) — protocol/version/rate-limit failures. */
export function errorMessage(payload: ErrorPayload, seq?: number): ProtocolEnvelope {
  return buildEnvelope("error", payload, errorPayloadSchema, seq);
}

export type {
  ProtocolEnvelope,
  HelloPayload,
  WelcomePayload,
  PlayerStatePayload,
  ChatPayload,
  LeavePayload,
  HeartbeatPayload,
  ErrorPayload,
} from "../schema/index.js";
