/**
 * Protocol v1 helpers tests (ADR-004).
 *
 * Encode/decode round-trip, the version gate (reject mismatched `v`), the
 * typed constructors for every catalog payload, and non-throwing decode.
 */
import { describe, expect, it } from "vitest";

import {
  PROTOCOL_V1,
  ProtocolDecodeError,
  ProtocolVersionMismatchError,
  chat,
  decodeMessage,
  decodeMessageSafe,
  decodeMessageValue,
  encodeMessage,
  errorMessage,
  hello,
  leave,
  ping,
  playerState,
  pong,
  welcome,
  type ProtocolEnvelope,
} from "../../src/index.js";

describe("protocol v1 encode/decode (ADR-004)", () => {
  it("round-trips a hello envelope through encode -> decode", () => {
    const message = hello(
      { playerName: "Aria", roomId: "room-alpha", projectId: "prj-sunrise-valley" },
      1,
    );
    const wire = encodeMessage(message);
    expect(typeof wire).toBe("string");

    const decoded = decodeMessage(wire);
    expect(decoded.v).toBe(PROTOCOL_V1);
    expect(decoded.type).toBe("hello");
    expect(decoded.seq).toBe(1);
    expect(decoded.payload.playerName).toBe("Aria");
    expect(decoded.payload.roomId).toBe("room-alpha");
  });

  it("tolerates a missing seq on decode (seq is optional)", () => {
    const message = ping({ clientTimeMs: 123 }, undefined);
    const decoded = decodeMessage(encodeMessage(message));
    expect(decoded.type).toBe("ping");
    expect(decoded.seq).toBeUndefined();
  });

  it("decodeMessageValue validates a parsed JSON value with the version gate", () => {
    const message = welcome({
      sessionId: "s-01ab",
      roomId: "room-alpha",
      serverTimeMs: 1,
      players: [{ sessionId: "s-01aa", playerName: "Kibo", state: { x: 16, y: 12, direction: "down", animation: "idle" } }],
    });
    const decoded = decodeMessageValue(JSON.parse(JSON.stringify(message)) as unknown);
    expect(decoded.type).toBe("welcome");
    expect(decoded.payload.sessionId).toBe("s-01ab");
  });

  it("throws ProtocolDecodeError for invalid JSON", () => {
    expect(() => decodeMessage("{not json")).toThrow(ProtocolDecodeError);
  });

  it("throws ProtocolDecodeError for a non-object message", () => {
    expect(() => decodeMessageValue("42")).toThrow(ProtocolDecodeError);
  });
});

describe("protocol v1 version gate (ADR-004)", () => {
  it("rejects a mismatched protocol version with ProtocolVersionMismatchError", () => {
    const raw = JSON.stringify({ v: 2, type: "hello", payload: {} });
    try {
      decodeMessage(raw);
      throw new Error("expected a version mismatch");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolVersionMismatchError);
      if (error instanceof ProtocolVersionMismatchError) {
        expect(error.clientVersion).toBe(2);
        expect(error.serverVersion).toBe(PROTOCOL_V1);
        expect(error.code).toBe("protocol_version_mismatch");
      }
    }
  });

  it("decodeMessageSafe reports the mismatch as an error result, not a throw", () => {
    const raw = JSON.stringify({ v: 99, type: "hello", payload: {} });
    const result = decodeMessageSafe(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ProtocolVersionMismatchError);
    }
  });

  it("decodeMessageSafe returns the decoded message on success", () => {
    const raw = encodeMessage(ping({ clientTimeMs: 5 }, 3));
    const result = decodeMessageSafe(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("ping");
      expect(result.message.seq).toBe(3);
    }
  });

  it("rejects a message missing the v field", () => {
    const raw = JSON.stringify({ type: "hello", payload: {} });
    expect(() => decodeMessage(raw)).toThrow(ProtocolDecodeError);
  });
});

describe("protocol v1 payload constructors", () => {
  it("builds every catalog message type with the right envelope fields", () => {
    const cases: Array<{ message: ProtocolEnvelope; type: string }> = [
      { message: hello({ playerName: "A", roomId: "r", projectId: "p" }, 1), type: "hello" },
      {
        message: welcome({
          sessionId: "s",
          roomId: "r",
          serverTimeMs: 1,
          players: [{ sessionId: "s", playerName: "A", state: { x: 1, y: 2, direction: "down" } }],
        }, 2),
        type: "welcome",
      },
      {
        message: playerState({ state: { x: 3, y: 4, direction: "left", animation: "walk" }, clientTimeMs: 5 }, 3),
        type: "player_state",
      },
      { message: chat({ text: "hi" }, 4), type: "chat" },
      { message: leave({ reason: "user_quit" }, 5), type: "leave" },
      { message: ping({ clientTimeMs: 6 }, 6), type: "ping" },
      { message: pong({ clientTimeMs: 6, serverTimeMs: 7 }, 7), type: "pong" },
      { message: errorMessage({ code: "internal_error", message: "boom" }, 8), type: "error" },
    ];

    for (const { message, type } of cases) {
      expect(message.v).toBe(PROTOCOL_V1);
      expect(message.type).toBe(type);
      // Constructed messages survive an encode/decode round-trip.
      const decoded = decodeMessage(encodeMessage(message));
      expect(decoded.type).toBe(type);
    }
  });

  it("validates payload shape against the per-type schema (fail fast)", () => {
    expect(() =>
      // missing playerName
      hello({ playerName: "", roomId: "r" }, 1),
    ).toThrow();
    expect(() =>
      // invalid direction
      playerState({ state: { x: 0, y: 0, direction: "sideways" as never } }, 1),
    ).toThrow();
  });

  it("exports the protocol version constant", () => {
    expect(PROTOCOL_V1).toBe(1);
  });
});