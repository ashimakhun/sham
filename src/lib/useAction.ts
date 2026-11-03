import { useState } from 'react';

/** Runs an async action with a busy flag and a user-readable error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  /** Forget the last error (e.g. when the form it belongs to closes). */
  const clearError = () => setError(null);

  return { busy, error, run, clearError };
}
