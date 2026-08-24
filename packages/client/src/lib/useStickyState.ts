import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

/**
 * `useState` whose value survives the component being unmounted.
 *
 * Routing between pages destroys and rebuilds each screen, which is the
 * right default for data but wrong for the small choices a person has
 * already made — which tab they were on, which file they had open, how
 * they had filtered a list. Those are keyed by name here and kept for as
 * long as the app is open (deliberately not persisted: they should not
 * outlive a restart).
 */
const memory = new Map<string, unknown>();

export function useStickyState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    memory.has(key) ? (memory.get(key) as T) : initial,
  );

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        memory.set(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}

/** Forgets one sticky value — e.g. when the thing it pointed at is gone. */
export function forgetStickyState(key: string): void {
  memory.delete(key);
}
