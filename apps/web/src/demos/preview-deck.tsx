import type { ReactNode } from 'react';

import { Icon } from '@/components/icon';
import { cn } from '@/lib/utils';

export type PreviewName = 'Profile' | 'Settings';

function ProfilePreview() {
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted shadow-xs">
        <Icon name="user" className="size-5" />
      </div>
      <div>
        <strong className="block text-xs font-normal">Alex Morgan</strong>
        <span className="block text-xs text-muted-foreground">Design engineer</span>
      </div>
      <div className="flex w-full justify-between pt-2 text-xs text-muted-foreground">
        <span>12 projects</span>
        <span className="flex items-center gap-1">
          Available <i className="size-1.5 rounded-full bg-primary" />
        </span>
      </div>
    </div>
  );
}

function PreviewToggle() {
  return (
    <i className="relative block h-3.5 w-6 shrink-0 rounded-full bg-muted p-px shadow-2xs after:absolute after:top-0.5 after:left-0.5 after:size-2.5 after:rounded-full after:bg-muted-foreground after:shadow-xs group-data-[active=true]/preview-card:after:translate-x-2.5 group-data-[active=true]/preview-card:after:bg-primary motion-safe:after:transition motion-safe:after:duration-150 motion-safe:after:ease-out" />
  );
}

function SettingsPreview() {
  return (
    <div className="divide-y divide-border px-3 py-2 text-xs">
      <div className="flex items-center justify-between py-2">
        <span>Appearance</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Icon name="sun" className="size-3" /> Auto
        </span>
      </div>
      <div className="flex items-center justify-between py-2">
        <span>Notifications</span>
        <PreviewToggle />
      </div>
      <div className="flex items-center justify-between gap-2 py-2">
        <span>Stay a little ahead</span>
        <PreviewToggle />
      </div>
    </div>
  );
}

function PreviewCard({
  name,
  active,
  children,
}: {
  name: PreviewName;
  active: PreviewName | null;
  children: ReactNode;
}) {
  const profile = name === 'Profile';

  return (
    <div
      className={cn(
        'absolute top-10 left-1/2 w-52 -translate-x-1/2 sm:w-60',
        active === name && 'z-10',
      )}
    >
      <div
        className={cn(
          'group/preview-card relative h-48 origin-bottom translate-y-2 overflow-hidden rounded-xl bg-card text-card-foreground shadow-md data-[active=true]:translate-x-0 data-[active=true]:translate-y-2 data-[active=true]:rotate-0 data-[active=true]:shadow-xl data-[muted=true]:translate-y-6 data-[muted=true]:scale-90 data-[muted=true]:opacity-35 motion-safe:transition motion-safe:duration-300 motion-safe:ease-out',
          profile
            ? '-translate-x-6 -rotate-6 data-[active=true]:ring-1 data-[active=true]:ring-emerald-500 data-[muted=true]:-translate-x-10 data-[muted=true]:blur-xs sm:-translate-x-10 sm:-rotate-12 sm:data-[muted=true]:-translate-x-16'
            : 'translate-x-6 rotate-6 data-[active=true]:ring-1 data-[active=true]:ring-blue-500 data-[muted=true]:translate-x-10 data-[muted=true]:blur-xs sm:translate-x-10 sm:rotate-12 sm:data-[muted=true]:translate-x-16',
        )}
        data-view={name}
        data-active={active === name}
        data-muted={active !== null && active !== name}
      >
        <div className="relative flex h-8 items-center gap-2 overflow-hidden rounded-t-[inherit] border-b border-border bg-muted px-3 text-xs group-data-[active=true]/preview-card:bg-accent group-data-[active=true]/preview-card:text-accent-foreground after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:-bottom-px after:rounded-t-[inherit] after:shadow-[0px_0px_0px_1px_color-mix(in_oklab,var(--shadow-light)_5.1%,transparent)_inset,0px_1px_0px_0px_color-mix(in_oklab,var(--shadow-light)_8.16%,transparent)_inset] motion-safe:transition-colors motion-safe:duration-150">
          <Icon name={profile ? 'user' : 'settings'} className="size-3" />
          <span>{name}</span>
          <span className="ml-auto text-muted-foreground">{profile ? '01' : '02'}</span>
        </div>
        {children}
        <div className="absolute inset-x-0 bottom-0 flex h-6 items-center justify-between border-t border-dashed border-border px-3 text-[10px] tracking-wide text-muted-foreground">
          <span>{profile ? 'YOUR SPACE' : 'MAKE IT YOURS'}</span>
          <Icon
            name="check"
            className="size-3 scale-25 text-primary opacity-0 blur-sm group-data-[active=true]/preview-card:scale-100 group-data-[active=true]/preview-card:opacity-100 group-data-[active=true]/preview-card:blur-none motion-safe:transition motion-safe:duration-300 motion-safe:ease-out"
          />
        </div>
      </div>
    </div>
  );
}

export function PreviewDeck({ active }: { active: PreviewName | null }) {
  return (
    <div
      className="group/deck pointer-events-none absolute inset-x-0 top-6 bottom-18"
      data-preview-active={active ?? 'none'}
      data-active={active !== null}
      aria-hidden="true"
    >
      <div
        className={cn(
          'absolute inset-x-6 inset-y-6 mx-auto max-w-sm text-primary',
          active === 'Profile' && 'text-emerald-500',
          active === 'Settings' && 'text-blue-500',
        )}
      >
        {[
          '-top-px -left-px border-t border-l',
          '-top-px -right-px border-t border-r',
          '-bottom-px -left-px border-b border-l',
          '-right-px -bottom-px border-r border-b',
        ].map((corner) => (
          <span
            key={corner}
            data-preview-corner=""
            className={cn(
              'absolute size-2 border-current opacity-0 group-data-[active=true]/deck:opacity-100 motion-safe:transition-opacity motion-safe:duration-150',
              corner,
            )}
          />
        ))}
      </div>
      <PreviewCard name="Profile" active={active}>
        <ProfilePreview />
      </PreviewCard>
      <PreviewCard name="Settings" active={active}>
        <SettingsPreview />
      </PreviewCard>
    </div>
  );
}
