/**
 * Chunk-worker entry (ADR-008 §4, S3c).
 *
 * Off-main-thread map-v1 chunk parsing: receives `{ id, type: "parse", file,
 * source }`, validates against the core map schema (fail-fast on unknown/
 * corrupt chunks), and replies `{ id, type: "parsed", ok, map | error }`.
 * Bundled as a separate esbuild entry by build-www (iife split: each worker
 * is its own file) — see ADR-008 Consequences.
 *
 * Written against a structural `self` cast (runtime tsconfig ships DOM lib
 * only, no WebWorker lib).
 */
import { parseMapDocument } from "@agenticrpg/core";

interface ParseRequest {
  id: number;
  type: "parse";
  file: string;
  source: unknown;
}

type ParseResponse =
  | { id: number; type: "parsed"; ok: true; map: unknown; file: string }
  | { id: number; type: "parsed"; ok: false; error: string; file: string };

const scope = self as unknown as {
  onmessage: ((event: { data: ParseRequest }) => void) | null;
  postMessage(data: ParseResponse): void;
};

scope.onmessage = (event) => {
  const message = event.data;
  try {
    const map = parseMapDocument(message.source);
    scope.postMessage({ id: message.id, type: "parsed", ok: true, map, file: message.file });
  } catch (error) {
    scope.postMessage({
      id: message.id,
      type: "parsed",
      ok: false,
      error: String(error),
      file: message.file,
    });
  }
};
