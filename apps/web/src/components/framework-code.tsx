import type { ReactNode } from 'react';

import { frameworks, frameworkNames, isFramework, usePreferences } from '@/lib/preferences';
import type { Framework } from '@/lib/preferences';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const frameworkIcons: Record<Framework, string> = {
  vanilla: '/icons/frameworks/javascript.svg',
  react: '/icons/frameworks/react.svg',
  vue: '/icons/frameworks/vue.svg',
  svelte: '/icons/frameworks/svelte.svg',
};

function FrameworkLabel({ framework }: { framework: Framework }) {
  return (
    <span className="flex items-center gap-2">
      <img
        src={frameworkIcons[framework]}
        alt=""
        aria-hidden="true"
        width={16}
        height={16}
        className="size-4 shrink-0"
      />
      {frameworkNames[framework]}
    </span>
  );
}

export function FrameworkSelect() {
  const { framework, setFramework } = usePreferences();

  return (
    <Select
      items={frameworkNames}
      value={framework}
      onValueChange={(value) => {
        if (value && isFramework(value)) {
          setFramework(value);
        }
      }}
    >
      <SelectTrigger aria-label="Code framework" className="min-w-24">
        <SelectValue>
          <FrameworkLabel framework={framework} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {frameworks.map((value) => (
          <SelectItem key={value} value={value} label={frameworkNames[value]}>
            <FrameworkLabel framework={value} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FrameworkCode({ children }: { children: ReactNode }) {
  return (
    <div data-framework-code="" className="min-w-0">
      {children}
    </div>
  );
}

export function FrameworkPanel({ value, children }: { value: Framework; children: ReactNode }) {
  const { framework } = usePreferences();

  return framework === value ? (
    <div data-framework-panel={value} className="document-section">
      {children}
    </div>
  ) : null;
}
