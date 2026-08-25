/**
 * React bindings for the editor store (P2, ADR-006 D13 React shell).
 *
 * `useEditorStore` subscribes a component to the store snapshot via
 * `useSyncExternalStore`; `useStoreSelector` narrows to a slice with a stable
 * reference per snapshot so components re-render only when their slice changes.
 */
import { useSyncExternalStore } from "react";
import type { EditorSnapshot, EditorStore } from "./state/editor-store.js";

/** Subscribe to the whole snapshot (re-renders on every store change). */
export function useEditorStore(store: EditorStore): EditorSnapshot {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
  );
}

/** Subscribe to a slice of the snapshot selected by `selector`. */
export function useStoreSelector<T>(
  store: EditorStore,
  selector: (snapshot: EditorSnapshot) => T,
): T {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => selector(store.getSnapshot()),
  );
}
