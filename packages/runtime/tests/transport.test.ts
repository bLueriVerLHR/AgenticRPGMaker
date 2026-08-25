/**
 * Transport + WebSocketTransport tests (ADR-004).
 *
 * Covers: protocol encode/decode (from core), the handshake state machine
 * (connect → open → hello → welcome), heartbeat ping/pong + silence watchdog
 * with fake timers, version-mismatch handling, and the TokenBucket rate
 * limiter. A fake WebSocket drives the transport deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProtocolEnvelope } from "@agenticrpg/core";
import { decodeMessage, encodeMessage, hello, welcome } from "@agenticrpg/core";

import { TokenBucket } from "../src/transport.js";
import type { WebSocketLike } from "../src/transport.js";
import { WebSocketTransport } from "../src/websocket-transport.js";
import { createNoopLogger } from "../src/logger.js";

/** A controllable fake WebSocket (satisfies WebSocketLike structurally). */
class FakeSocket implements WebSocketLike {
  url: string;
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  fail(error: unknown): void {
    this.onerror?.(error);
  }

  drop(code = 1006, reason = "drop"): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function decodeFirst(socket: FakeSocket): ProtocolEnvelope {
  const raw = socket.sent[0]!;
  return decodeMessage(raw);
}

function makeTransport(socket: FakeSocket): WebSocketTransport {
  return new WebSocketTransport({
    socketFactory: () => socket,
    logger: createNoopLogger(),
    now: () => Date.now(),
    handshakeTimeoutMs: 5000,
  });
}

function welcomeEnvelope(sessionId = "s-01ab"): ProtocolEnvelope {
  return welcome({
    sessionId,
    roomId: "room-alpha",
    serverTimeMs: Date.now(),
    players: [],
  });
}

describe("protocol encode/decode (core helpers)", () => {
  it("round-trips an envelope", () => {
    const envelope = hello({ playerName: "Aria", roomId: "room-alpha" }, 1);
    const raw = encodeMessage(envelope);
    const decoded = decodeMessage(raw);
    expect(decoded).toMatchObject({ v: 1, type: "hello", seq: 1 });
    expect(decoded.payload).toMatchObject({ playerName: "Aria", roomId: "room-alpha" });
  });
});

describe("WebSocketTransport handshake state machine", () => {
  it("sends hello on open and resolves connect on welcome", async () => {
    const socket = new FakeSocket("ws://localhost/ws");
    const transport = makeTransport(socket);
    const connect = transport.connect("ws://localhost/ws", {
      roomId: "room-alpha",
      playerName: "Aria",
      projectId: "prj-1",
    });
    expect(transport.state).toBe("connecting");
    socket.open();
    expect(transport.state).toBe("handshaking");
    const helloEnvelope = decodeFirst(socket);
    expect(helloEnvelope.type).toBe("hello");
    expect(helloEnvelope.payload).toMatchObject({
      playerName: "Aria",
      roomId: "room-alpha",
      projectId: "prj-1",
    });
    socket.receive(encodeMessage(welcomeEnvelope("s-01ab")));
    await expect(connect).resolves.toBeUndefined();
    expect(transport.state).toBe("ready");
    expect(transport.sessionId).toBe("s-01ab");
  });

  it("rejects when the socket closes before the handshake completes", async () => {
    const socket = new FakeSocket("ws://localhost/ws");
    const transport = makeTransport(socket);
    const connect = transport.connect("ws://localhost/ws");
    socket.open();
    socket.drop(1006, "boom");
    await expect(connect).rejects.toThrow(/closed before handshake ready/);
    expect(transport.state).toBe("closed");
  });

  it("rejects when the handshake times out", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket("ws://localhost/ws");
      const transport = makeTransport(socket);
      const connect = transport.connect("ws://localhost/ws");
      socket.open();
      vi.advanceTimersByTime(6000);
      await expect(connect).rejects.toThrow(/handshake timed out/);
      expect(socket.closed.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cannot connect twice", async () => {
    const socket = new FakeSocket("ws://localhost/ws");
    const transport = makeTransport(socket);
    const connect = transport.connect("ws://localhost/ws");
    socket.open();
    socket.receive(encodeMessage(welcomeEnvelope()));
    await connect;
    await expect(transport.connect("ws://localhost/ws")).rejects.toThrow(
      /cannot connect from state/,
    );
  });
});

describe("WebSocketTransport heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings on the heartbeat interval and tracks pong latency", async () => {
    const socket = new FakeSocket("ws://localhost/ws");
    const transport = makeTransport(socket);
    const connect = transport.connect("ws://localhost/ws", { heartbeatMs: 15000 });
    socket.open();
    socket.receive(encodeMessage(welcomeEnvelope()));
    await connect;
    const sentBefore = socket.sent.length;
    vi.advanceTimersByTime(15000);
    const ping = decodeMessage(socket.sent[sentBefore]!);
    expect(ping.type).toBe("ping");
    expect(typeof (ping.payload as { clientTimeMs?: number }).clientTimeMs).toBe("number");
    // Reply with a pong echoing the ping's clientTimeMs.
    const clientTimeMs = (ping.payload as { clientTimeMs: number }).clientTimeMs;
    socket.receive(
      encodeMessage({
        v: 1,
        type: "pong",
        payload: { clientTimeMs, serverTimeMs: clientTimeMs + 20 },
      }),
    );
    expect(transport.latencyMs).not.toBeNull();
  });

  it("closes when the server stays silent past the timeout", async () => {
    const socket = new FakeSocket("ws://localhost/ws");
    const transport = makeTransport(socket);
    const connect = transport.connect("ws://localhost/ws", {
      heartbeatMs: 15000,
      timeoutMs: 60000,
    });
    socket.open();
    socket.receive(encodeMessage(welcomeEnvelope()));
    await connect;
    const closeHandler = vi.fn();
    transport.onClose(closeHandler);
    vi.advanceTimersByTime(61000); // past the 60s silence watchdog
    expect(closeHandler).toHaveBeenCalledWith(4000, "heartbeat_timeout");
    expect(transport.state).toBe("closed");
  });

  it("close() sends leave then closes (ADR-004)", async () => {
    const socket = new FakeSocket("ws://localhost/ws");
    const transport = makeTransport(socket);
    const connect = transport.connect("ws://localhost/ws");
    socket.open();
    socket.receive(encodeMessage(welcomeEnvelope()));
    await connect;
    transport.close();
    const last = decodeMessage(socket.sent[socket.sent.length - 1]!);
    expect(last.type).toBe("leave");
    expect(last.payload).toMatchObject({ reason: "user_quit" });
    expect(socket.closed.length).toBeGreaterThan(0);
    expect(transport.state).toBe("closed");
  });
});

describe("WebSocketTransport inbound handling", () => {
  it("delivers raw + envelope handlers and ignores unknown types (ADR-004)", async () => {
    const socket = new FakeSocket("ws://localhost/ws");
    const transport = makeTransport(socket);
    const rawHandler = vi.fn();
    const envelopeHandler = vi.fn();
    transport.onMessage(rawHandler);
    transport.onEnvelope(envelopeHandler);
    const connect = transport.connect("ws://localhost/ws");
    socket.open();
    socket.receive(encodeMessage(welcomeEnvelope()));
    await connect;
    socket.receive(encodeMessage({ v: 1, type: "chat", payload: { text: "hi" } }));
    expect(rawHandler).toHaveBeenCalled();
    expect(envelopeHandler).toHaveBeenCalled();
    expect(envelopeHandler.mock.calls[0]![0].envelope.type).toBe("welcome");
  });
});

describe("TokenBucket rate limiter", () => {
  it("allows `rate` tokens per second and then blocks", () => {
    let now = 0;
    const bucket = new TokenBucket(10, 15, () => now);
    // Burst capacity is 15 up front.
    for (let i = 0; i < 15; i++) {
      expect(bucket.tryTake()).toBe(true);
    }
    expect(bucket.tryTake()).toBe(false);
    // Refills 10 tokens per second.
    now += 1000;
    expect(bucket.availableTokens).toBeCloseTo(10, 5);
  });

  it("coalesces at most rate-per-second over a window", () => {
    let now = 0;
    const bucket = new TokenBucket(10, 15, () => now);
    let taken = 0;
    for (let ms = 0; ms < 3000; ms += 100) {
      now = ms;
      if (bucket.tryTake()) {
        taken++;
      }
    }
    // 3 seconds → ~30 tokens available (burst 15 + refills), but only 30 tries.
    expect(taken).toBe(30);
  });
});
