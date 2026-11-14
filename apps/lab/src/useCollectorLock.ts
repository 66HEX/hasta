import { useEffect, useState } from 'react';

export function useCollectorLock() {
  const [state, setState] = useState<'pending' | 'owned' | 'blocked'>(() =>
    'locks' in navigator ? 'pending' : 'blocked',
  );

  useEffect(() => {
    let disposed = false;
    let release: (() => void) | null = null;

    queueMicrotask(() => {
      if (disposed || !('locks' in navigator)) {
        return;
      }

      void navigator.locks
        .request('hasta-lab-collection', { ifAvailable: true }, async (lock) => {
          if (disposed) {
            return;
          }

          if (lock === null) {
            setState('blocked');

            return;
          }

          setState('owned');
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        })
        .catch(() => {
          if (!disposed) {
            setState('blocked');
          }
        });
    });

    return () => {
      disposed = true;
      release?.();
    };
  }, []);

  return state;
}
