/**
 * Protocol v1 schema tests (ADR-004): envelope shape, message catalog,
 * unknown-version rejection, additive-extension tolerance, round-trip.
 */
import { describe, expect, it } from "vitest";

import { protocolEnvelopeSchema, protocolMessageTypeSchema } from "../../src/index.js";

function makeEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    type: "hello",
    seq: 1,
    payload: { playerName: "Aria", roomId: "room-alpha", projectId: "prj-sunrise-valley" },
    ...overrides,
  };
}

describe("protocol envelope (v1, ADR-004)", () => {
  it("parses a valid hello envelope", () => {
    const result = protocolEnvelopeSchema.safeParse(makeEnvelope());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.v).toBe(1);
      expect(result.data.type).toBe("hello");
      expect(result.data.seq).toBe(1);
      expect(result.data.payload.playerName).toBe("Aria");
    }
  });

  it("parses an envelope without seq (seq is optional)", () => {
    const input = makeEnvelope();
    delete input.seq;
    expect(protocolEnvelopeSchema.safeParse(input).success).toBe(true);
  });

  it("accepts future additive message types in the envelope", () => {
    // ADR-004: new message types are additive; clients ignore unknown types.
    const input = makeEnvelope({ type: "world_state_delta" });
    expect(protocolEnvelopeSchema.safeParse(input).success).toBe(true);
    // The catalog enum is stricter, but the envelope is the wire contract:
    expect(protocolMessageTypeSchema.safeParse("world_state_delta").success).toBe(false);
  });

  it("rejects a missing v field", () => {
    const input = makeEnvelope();
    delete input.v;
    expect(protocolEnvelopeSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an unknown protocol version (v != 1)", () => {
    expect(protocolEnvelopeSchema.safeParse(makeEnvelope({ v: 2 })).success).toBe(false);
  });

  it("rejects a missing payload", () => {
    const input = makeEnvelope();
    delete input.payload;
    expect(protocolEnvelopeSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(protocolEnvelopeSchema.safeParse(makeEnvelope({ payload: "nope" })).success).toBe(false);
  });

  it("round-trips stably", () => {
    const parsed = protocolEnvelopeSchema.parse(makeEnvelope());
    const reparsed = protocolEnvelopeSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });
});
