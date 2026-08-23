import { useCallback, useRef, useState } from "react";

export interface GraphSnapshot<N, E> {
  nodes: N[];
  edges: E[];
}

/**
 * Undo/redo stack for the canvas. Callers decide *when* a snapshot is
 * worth recording (drag stop, connect, delete, a debounced field edit) —
 * this hook just keeps past/future arrays and hands back the state to
 * restore. `canUndo`/`canRedo` are exposed via a render-forcing counter
 * since the stacks live in refs to avoid re-render churn on every commit.
 */
export function useHistory<N, E>(limit = 50) {
  const past = useRef<GraphSnapshot<N, E>[]>([]);
  const future = useRef<GraphSnapshot<N, E>[]>([]);
  // Mirrored into state so render never reads the refs directly.
  const [depths, setDepths] = useState({ past: 0, future: 0 });
  const bump = () =>
    setDepths({ past: past.current.length, future: future.current.length });

  const record = useCallback(
    (snapshot: GraphSnapshot<N, E>) => {
      past.current.push(snapshot);
      if (past.current.length > limit) past.current.shift();
      future.current = [];
      bump();
    },
    [limit],
  );

  const undo = useCallback(
    (current: GraphSnapshot<N, E>): GraphSnapshot<N, E> | null => {
      const prev = past.current.pop();
      if (!prev) return null;
      future.current.push(current);
      bump();
      return prev;
    },
    [],
  );

  const redo = useCallback(
    (current: GraphSnapshot<N, E>): GraphSnapshot<N, E> | null => {
      const next = future.current.pop();
      if (!next) return null;
      past.current.push(current);
      bump();
      return next;
    },
    [],
  );

  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    bump();
  }, []);

  return {
    record,
    undo,
    redo,
    reset,
    canUndo: depths.past > 0,
    canRedo: depths.future > 0,
  };
}
