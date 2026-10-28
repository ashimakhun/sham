import { useEffect, useState } from 'react';

/** The current time, updated every `intervalMs`, so time-based UI (e.g. "Mark completed" once a meeting starts)
 *  changes without waiting for new data. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
