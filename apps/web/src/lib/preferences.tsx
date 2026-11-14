import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export const frameworks = ['vanilla', 'react', 'vue', 'svelte', 'solid'] as const;

export type Framework = (typeof frameworks)[number];

export const frameworkNames = {
  vanilla: 'Vanilla',
  react: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  solid: 'Solid',
};

export function isFramework(value: string | null): value is Framework {
  return frameworks.some((framework) => framework === value);
}

function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences remain usable when storage is unavailable
  }
}

interface Preferences {
  framework: Framework;
  setFramework: (framework: Framework) => void;
  dark: boolean;
  toggleTheme: () => void;
}

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [framework, updateFramework] = useState<Framework>(() => {
    const saved = readPreference('hasta.framework') ?? readPreference('futura.framework');

    return isFramework(saved) ? saved : 'react';
  });

  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    writePreference('hasta.theme', dark ? 'dark' : 'light');
  }, [dark]);

  const value = useMemo<Preferences>(
    () => ({
      framework,
      setFramework(next) {
        updateFramework(next);
        writePreference('hasta.framework', next);
      },
      dark,
      toggleTheme() {
        setDark((current) => !current);
      },
    }),
    [framework, dark],
  );

  return <PreferencesContext value={value}>{children}</PreferencesContext>;
}

export function usePreferences(): Preferences {
  const preferences = useContext(PreferencesContext);

  if (!preferences) {
    throw new Error('PreferencesProvider is required.');
  }

  return preferences;
}
