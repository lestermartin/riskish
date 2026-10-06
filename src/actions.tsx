import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Run = (p: Promise<unknown>) => Promise<boolean>;

const ActionContext = createContext<Run>(async p => {
  await p;
  return true;
});

/** Provides `run(promise)`, which reports reducer errors in a toast. */
export function ActionProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const run = useCallback<Run>(async p => {
    try {
      await p;
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setError(null), 4000);
      return false;
    }
  }, []);

  return (
    <ActionContext.Provider value={run}>
      {children}
      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </ActionContext.Provider>
  );
}

export function useRun(): Run {
  return useContext(ActionContext);
}
