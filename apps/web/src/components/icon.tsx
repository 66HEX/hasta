import {
  IconBrightnessIncrease,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCircleInfo,
  IconCopy,
  IconEnvelope,
  IconGear,
  IconLink,
  IconMoon,
  IconPointer,
  IconUser,
  IconXmark,
} from 'nucleo-pixel';
import type { IconProps } from 'nucleo-pixel';

import { cn } from '@/lib/utils';

const icons = {
  check: IconCheck,
  'chevron-down': IconChevronDown,
  'chevron-up': IconChevronUp,
  info: IconCircleInfo,
  copy: IconCopy,
  cursor: IconPointer,
  mail: IconEnvelope,
  settings: IconGear,
  link: IconLink,
  moon: IconMoon,
  sun: IconBrightnessIncrease,
  user: IconUser,
  close: IconXmark,
};

export type IconName = keyof typeof icons;

export function Icon({ name, className, ...props }: IconProps & { name: IconName }) {
  const Component = icons[name];

  return (
    <Component
      className={cn('shrink-0', className)}
      size={24}
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}
