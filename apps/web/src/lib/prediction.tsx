import { useHasta } from 'hasta/react';
import type { HastaController } from 'hasta/react';
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface PredictionState {
  controller: HastaController;
  horizon: number;
  setHorizon: (value: number) => void;
  margin: number;
  setMargin: (value: number) => void;
  debug: boolean;
  setDebug: (value: boolean) => void;
}

const PredictionContext = createContext<PredictionState | null>(null);

export function PredictionProvider({ children }: { children: ReactNode }) {
  const [horizon, setHorizon] = useState(160);
  const [margin, setMargin] = useState(4);
  const [debug, setDebug] = useState(false);
  const controller = useHasta({ horizonMs: horizon, debug });

  const value = useMemo(
    () => ({ controller, horizon, setHorizon, margin, setMargin, debug, setDebug }),
    [controller, horizon, margin, debug],
  );

  return <PredictionContext value={value}>{children}</PredictionContext>;
}

export function usePrediction(): PredictionState {
  const prediction = useContext(PredictionContext);

  if (!prediction) {
    throw new Error('PredictionProvider is required.');
  }

  return prediction;
}
