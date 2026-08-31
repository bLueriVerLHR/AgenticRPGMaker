/**
 * NetworkClient tests (ADR-004; docs/06-architecture.md §5).
 *
 * A fake Transport drives the client: handshake (welcome spawns remote
 * players), ~10 Hz rate-limited + coalesced player_state sends, remote state
 * application with interpolation, chat rate limiting (2/s, 200 chars), and
 * leave. Fake timers control the send loop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProtocolEnvelope } from "@agenticrpg/core";

import { NetworkClient } from "../src/network-client.js";
import type { Transport, TransportMessageHandler } from "../src/transport.js";
import { createNoopLogger } from "../src/logger.js";

/** A controllable in-memory Transport for the client. */
class FakeTransport implements Transport {
  url = "";
  closeCalled = false;
  readonly sent: string[] = [];
  private msgHandler: TransportMessageHandler | null = null;

  connect(url: string): Promise<void> {
    this.url = url;
    return Promise.resolve();
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalled = true;
  }

  onMessage(handler: TransportMessageHandler): () => void {
    this.msgHandler = handler;
    return () => {
      if (this.msgHandler === handler) {
        this.msgHandler = null;
      }
    };
  }

  onClose(): () => void {
    return () => {};
  }

  onError(): () => void {
    return () => {};
  }

  /** Deliver an envelope to the client exactly as the wire would. */
  emit(envelope: ProtocolEnvelope): void {
    this.msgHandler?.(JSON.stringify(envelope));
  }

  sentEnvelopes(): Array<ProtocolEnvelope & { payload: Record<string, unknown> }> {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

function welcomeEnvelope(
  sessionId = "s-local",
  others: Array<{ id: string; name: string; x: number; y: number }> = [],
) {
  return {
    v: 1,
    type: "welcome",
    payload: {
      sessionId,
      roomId: "room-alpha",
      serverTimeMs: Date.now(),
      players: [
        {
          sessionId,
          playerName: "Aria",
          state: { x: 1, y: 1, direction: "down", animation: "idle" },
        },
        ...others.map((o) => ({
          sessionId: o.id,
          playerName: o.name,
          state: { x: o.x, y: o.y, direction: "left" as const, animation: "idle" },
        })),
      ],
    },
  } as unknown as ProtocolEnvelope;
}

async function connectedClient(transport: FakeTransport, options: Record<string, unknown> = {}) {
  const client = new NetworkClient({
    transport,
    roomId: "room-alpha",
    playerName: "Aria",
    projectId: "prj-1",
    logger: createNoopLogger(),
    ...options,
  });
  await client.connect("ws://localhost/ws");
  return client;
}

describe("NetworkClient handshake", () => {
  it("connects, joins the room, and spawns remote players from welcome", async () => {
    const transport = new FakeTransport();
    const client = await connectedClient(transport);
    expect(client.connected).toBe(true);
    transport.emit(welcomeEnvelope("s-local", [{ id: "s-other", name: "Kibo", x: 5, y: 5 }]));
    expect(client.sessionId).toBe("s-local");
    expect(client.remotePlayers.has("s-other")).toBe(true);
    const kibo = client.remotePlayers.get("s-other");
    expect(kibo?.playerName).toBe("Kibo");
    expect(kibo?.x).toBe(5);
    client.close();
  });

  it("tolerates a state-less member in welcome (no throw; spawns at default (0,0))", async () => {
    const transport = new FakeTransport();
    const client = await connectedClient(transport);
    // Regression: a member that joined but has not yet sent its first
    // player_state appears in welcome WITHOUT a state field. The client must
    // not throw "Cannot read properties of undefined (reading 'x')".
    const envelope = welcomeEnvelope("s-local") as {
      payload: { players: Array<Record<string, unknown>> };
    };
    envelope.payload.players.push({
      sessionId: "s-early",
      playerName: "Early",
      // no `state` field — the regression case
    });
    expect(() =>
      transport.emit(envelope as unknown as import("@agenticrpg/core").ProtocolEnvelope),
    ).not.toThrow();
    const early = client.remotePlayers.get("s-early");
    expect(early).toBeDefined();
    expect(early?.x).toBe(0);
    expect(early?.y).toBe(0);
    client.close();
  });

  it("ignores a player_state without a valid state (no throw)", async () => {
    const transport = new FakeTransport();
    const client = await connectedClient(transport);
    transport.emit(welcomeEnvelope("s-local", [{ id: "s-other", name: "Kibo", x: 5, y: 5 }]));
    expect(() =>
      transport.emit({
        v: 1,
        type: "player_state",
        payload: { sessionId: "s-other" }, // missing `state` — the regression case
      } as unknown as import("@agenticrpg/core").ProtocolEnvelope),
    ).not.toThrow();
    // The existing remote keeps its last position (not clobbered).
    expect(client.remotePlayers.get("s-other")?.x).toBe(5);
    client.close();
  });
});

describe("NetworkClient player_state rate limiting (10 Hz, coalesced)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the latest state at ~10 Hz and coalesces intermediate updates", async () => {
    const transport = new FakeTransport();
    const client = await connectedClient(transport, { sendLoopMs: 100, stateRateHz: 10 });
    transport.emit(welcomeEnvelope());

    // Flood 100 updates over the simulation; only flushes send.
    for (let i = 0; i < 100; i++) {
      client.setLocalState({ x: i, y: 0, direction: "right", animation: "walk" });
    }
    vi.advanceTimersByTime(1000); // 10 flush ticks
    const states = transport.sentEnvelopes().filter((e) => e.type === "player_state");
    expect(states.length).toBeLessThanOrEqual(10);
    expect(states.length).toBeGreaterThan(0);
    // The last sent state is the latest value (coalescing).
    const last = states[states.length - 1]!.payload.state as { x: number };
    expect(last.x).toBe(99);
    client.close();
  });

  it("does not exceed the state rate across a longer window", async () => {
    const transport = new FakeTransport();
    const client = await connectedClient(transport, { sendLoopMs: 100, stateRateHz: 10 });
    transport.emit(welcomeEnvelope());
    for (let i = 0; i < 50; i++) {
      client.setLocalState({ x: i, y: i, direction: "down", animation: "walk" });
    }
    vi.advanceTimersByTime(3000); // 30 flush ticks, bucket refills 10/s
    const states = transport.sentEnvelopes().filter((e) => e.type === "player_state");
    expect(states.length).toBeLessThanOrEqual(30);
    client.close();
  });
});

describe("NetworkClient chat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps chat length at 200 chars", async () => {
    const transport = new FakeTransport();
    const client = await connectedClient(transport, { chatRateHz: 2 });
    transport.emit(welcomeEnvelope());
    const long = "x".repeat(300);
    const sentLong = client.sendChat(long);
    expect(sentLong).toBe(true);
    const chats = transport.sentEnvelopes().filter((e) => e.type === "chat");
    expect(chats[0]!.payload.text).toHaveLength(200); // truncated
    client.close();
  });

  it("rate-limits chat to the configured rate (2/s)", async () => {
    const transport = new FakeTransport();
    const client = await connectedClient(transport, { chatRateHz: 2 });
    transport.emit(welcomeEnvelope());
    const results = ["a", "b", "c", "d"].map((text) => client.sendChat(text));
    expect(results.filter(Boolean)).toHaveLength(2); // burst of 2, then blocked
    const chats = transport.sentEnvelopes().filter((e) => e.type === "chat");
    expect(chats).toHaveLength(2);
    client.close();
  });

  it("ignores chat when not connected", async () => {
    const transport = new FakeTransport();
    const client = new NetworkClient({ transport, logger: createNoopLogger() });
    expect(client.sendChat("hi")).toBe(false);
  });
});

describe("NetworkClient remote state application", () => {
  it("applies remote player_state with interpolation", async () => {
    const transport = new FakeTransport();
    const client = await connectedClient(transport);
    transport.emit(welcomeEnvelope("s-local", [{ id: "s-other", name: "Kibo", x: 10, y: 10 }]));
    const other = client.remotePlayers.get("s-other")!;
    expect(other.x).toBe(10);

    // A new state arrives: the client interpolates toward it.
    transport.emit({
      v: 1,
      type: "player_state",
      payload: {
        sessionId: "s-other",
        state: { x: 20, y: 10, direction: "right", animation: "walk" },
        clientTimeMs: Date.now(),
      },
    } as unknown as ProtocolEnvelope);
    expect(other.prevX).toBe(10); // baseline = previous display
    expect(other.targetX).toBe(20); // the state being interpolated toward
    expect(other.x).toBe(10); // display still at the baseline until update
    expect(other.interpT).toBe(0);

    client.update(0.06); // ~60ms of the 120ms window
    expect(other.x).toBeGreaterThan(10);
    expect(other.x).toBeLessThan(20);
    client.update(0.1);
    expect(other.x).toBe(20); // reached the target
    client.close();
  });

  it("removes a remote player on leave", async () => {
    const transport = new FakeTransport();
    const client = await connectedClient(transport);
    transport.emit(welcomeEnvelope("s-local", [{ id: "s-other", name: "Kibo", x: 1, y: 1 }]));
    const left: string[] = [];
    client.onRemotePlayerLeave((id) => left.push(id));
    transport.emit({
      v: 1,
      type: "leave",
      payload: { sessionId: "s-other", reason: "user_quit" },
    } as unknown as ProtocolEnvelope);
    expect(client.remotePlayers.has("s-other")).toBe(false);
    expect(left).toEqual(["s-other"]);
    client.close();
  });
});
