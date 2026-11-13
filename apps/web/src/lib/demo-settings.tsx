import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface DemoSettings {
  horizon: number;
  setHorizon: (value: number) => void;
  margin: number;
  setMargin: (value: number) => void;
}

const DemoSettingsContext = createContext<DemoSettings | null>(null);

export function DemoSettingsProvider({ children }: { children: ReactNode }) {
  const [horizon, setHorizon] = useState(160);
  const [margin, setMargin] = useState(8);
  const value = useMemo(() => ({ horizon, setHorizon, margin, setMargin }), [horizon, margin]);

  return <DemoSettingsContext value={value}>{children}</DemoSettingsContext>;
}

export function useDemoSettings(): DemoSettings {
  const settings = useContext(DemoSettingsContext);

  if (!settings) {
    throw new Error('DemoSettingsProvider is required.');
  }

  return settings;
}
