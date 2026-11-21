import { useHastaTarget } from '@66hex/hasta/react';
import { Popover } from '@base-ui/react/popover';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { DoakesVideo } from '@/components/doakes-video';
import { usePrediction } from '@/lib/prediction';

import { version as hastaVersion } from '../../../../packages/hasta/package.json';
import { Badge } from './ui/badge';

export function HeaderBrand() {
  const { controller, horizon, margin } = usePrediction();
  const anchor = useRef<HTMLAnchorElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const hasOpened = useRef(false);
  const playbackBlocked = useRef(false);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const popupId = useId();

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const blockPlayback = useCallback(() => {
    playbackBlocked.current = true;
    setOpen(false);
  }, []);

  const binding = useHastaTarget(controller, {
    when: { type: 'intersects', withinMs: horizon, marginPx: margin, includeCurrent: true },
    onPredict() {
      if (
        open ||
        hasOpened.current ||
        playbackBlocked.current ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        return;
      }

      setKeyboard(false);
      setReady(false);
      setOpen(true);
    },
  });

  const setAnchor = useCallback(
    (element: HTMLAnchorElement | null) => {
      anchor.current = element;
      binding.ref(element);
    },
    [binding],
  );

  useEffect(() => {
    let frame = 0;

    function focusWhenVisible() {
      const element = popup.current;

      if (element !== null && element.checkVisibility({ visibilityProperty: true })) {
        element.focus();

        return;
      }

      frame = requestAnimationFrame(focusWhenVisible);
    }

    if (open && ready && keyboard) {
      frame = requestAnimationFrame(focusWhenVisible);
    }

    return () => cancelAnimationFrame(frame);
  }, [open, ready, keyboard]);

  useEffect(() => {
    const allowPlayback = (event: Event) => {
      if (event.isTrusted) {
        playbackBlocked.current = false;
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        close();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('click', allowPlayback, true);
    document.addEventListener('keydown', allowPlayback, true);
    window.addEventListener('pagehide', close);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('click', allowPlayback, true);
      document.removeEventListener('keydown', allowPlayback, true);
      window.removeEventListener('pagehide', close);
    };
  }, [close]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === 'escape-key') {
          close();
        } else {
          details.cancel();
        }
      }}
    >
      <div className="flex items-center gap-3">
        <a
          ref={setAnchor}
          href="#main-content"
          className="flex items-center gap-2 type-display text-lg"
          aria-label="Hasta home"
          aria-haspopup="dialog"
          aria-expanded={open && ready}
          aria-controls={open && ready ? popupId : undefined}
          aria-keyshortcuts="ArrowDown"
          data-hasta-label="Hasta"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();

              if (open) {
                popup.current?.focus();

                return;
              }

              if (hasOpened.current) {
                return;
              }

              setReady(false);
              setKeyboard(true);
              setOpen(true);
            }
          }}
        >
          <img src="/logo.svg" alt="" aria-hidden="true" className="h-4 w-auto dark:invert" />
          <h1>hasta</h1>
        </a>
        <Badge className="hidden sm:block" variant="secondary">
          {hastaVersion}
        </Badge>
      </div>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={24}
          collisionPadding={24}
          className="z-50"
        >
          <Popover.Popup
            ref={popup}
            id={popupId}
            aria-label="Surprise from Doakes"
            aria-description="Escape closes the clip."
            data-ready={ready}
            initialFocus={false}
            finalFocus={keyboard ? anchor : false}
            className="relative w-80 max-w-[calc(100vw-3rem)] origin-top-left -rotate-4 rounded-xl bg-popover p-1.5 text-popover-foreground shadow-xl data-ending-style:translate-y-1 data-ending-style:opacity-0 data-starting-style:translate-y-1 data-starting-style:rotate-0 data-starting-style:opacity-0 data-[ready=false]:invisible data-[ready=false]:rotate-0 data-[ready=false]:opacity-0 motion-safe:transition-[opacity,transform,translate,rotate] motion-safe:duration-150 motion-safe:ease-out motion-reduce:rotate-0 motion-reduce:data-ending-style:translate-y-0 motion-reduce:data-starting-style:translate-y-0"
          >
            <DoakesVideo
              active={open}
              onPlaying={() => {
                if (!open) {
                  return;
                }

                hasOpened.current = true;
                setReady(true);
              }}
              onBlocked={blockPlayback}
              onEnded={close}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
