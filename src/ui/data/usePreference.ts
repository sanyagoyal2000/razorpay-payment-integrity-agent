"use client";

import { useCallback, useEffect, useState } from "react";

const PREFIX = "payment-integrity:pref:";

/**
 * A per-viewer UI preference (such as saved filters) kept in localStorage.
 * Starts from `initial` on the server and first render, then loads the saved
 * value after mount so hydration always matches.
 */
export function usePreference<T>(key: string, initial: T): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw) setValue({ ...initial, ...(JSON.parse(raw) as T) });
    } catch {
      // Unreadable preference: keep the default.
    }
    setLoaded(true);
    // `initial` is a constant default for this key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(next));
      } catch {
        // Storage unavailable: the preference lasts for this session only.
      }
    },
    [key],
  );
  return [value, update, loaded];
}
