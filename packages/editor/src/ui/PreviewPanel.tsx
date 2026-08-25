/**
 * Preview panel (P2, ADR-006 §feature 6): embeds the real runtime over the
 * current map. While open, edits restart the embedded game so preview is
 * WYSIWYG (same core model drives both sides — docs/06-architecture.md §4).
 */
import { useEffect, useRef, useState } from "react";
import type { EditorStore } from "../state/editor-store.js";
import { currentMapOf } from "../state/editor-store.js";
import { useStoreSelector } from "../use-editor-store.js";
import { startPreview, type PreviewHandle } from "../preview/preview.js";
import type { EditorLogger } from "../logger.js";

export function PreviewPanel({
  store,
  logger,
}: {
  store: EditorStore;
  logger: EditorLogger;
}): React.JSX.Element {
  const snapshot = useStoreSelector(store, (s) => s);
  const map = currentMapOf(snapshot);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  const [status, setStatus] = useState<string>("starting…");
  const [bootError, setBootError] = useState<string | null>(null);
  // Generation counter: cancels a stale boot when the map changes mid-start.
  const generationRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (canvas === null || root === null) {
      return;
    }

    const generation = ++generationRef.current;
    let cancelled = false;
    setStatus("starting…");
    setBootError(null);

    // Restart the embedded game for the current map (WYSIWYG on edits).
    const disposeOld = (): void => {
      if (handleRef.current !== null) {
        handleRef.current.dispose();
        handleRef.current = null;
      }
      // Remove runtime DOM (HUD / dialogue / virtual controls) the previous
      // boot may have appended to the preview root.
      root.replaceChildren();
    };

    const boot = async (): Promise<void> => {
      disposeOld();
      try {
        const handle = await startPreview({
          canvas,
          root,
          map,
          tilesets: snapshot.tilesets,
          logger,
        });
        if (cancelled || generation !== generationRef.current) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        setStatus(`running (${handle.game.scene.backendLabel})`);
      } catch (error) {
        if (!cancelled) {
          setBootError(String(error));
          setStatus("boot failed");
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      disposeOld();
    };
    // Restart whenever the map document or the open project's tilesets change.
    // `snapshot.maps` is compared by reference: edits produce new map objects.
  }, [map, snapshot.tilesets, logger]);

  return (
    <div className="preview-wrap" data-testid="preview-panel">
      <canvas
        ref={canvasRef}
        className="preview-canvas"
        data-testid="preview-canvas"
        width={640}
        height={480}
      />
      <div ref={rootRef} className="preview-root" data-testid="preview-root" />
      {bootError !== null && (
        <div className="empty" data-testid="preview-error">
          Preview failed: {bootError}
        </div>
      )}
      <div className="preview-status" data-testid="preview-status">
        {status}
      </div>
    </div>
  );
}
