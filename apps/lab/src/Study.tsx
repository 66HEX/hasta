import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

import { sceneFor } from './plan';
import { currentPlan } from './protocol';
import { recordTrial } from './recorder';
import type { Session, Trial } from './types';

export function Study({
  session,
  disabled,
  onComplete,
  onActive,
  onStart,
}: {
  session: Session;
  disabled: boolean;
  onComplete: (trial: Trial) => void;
  onActive: (active: boolean) => void;
  onStart: (trial: Trial) => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  const recorder = useRef<ReturnType<typeof recordTrial> | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [plan, setPlan] = useState(() => currentPlan(session));
  const [active, setActive] = useState(false);
  const [result, setResult] = useState<Trial | null>(null);
  const [message, setMessage] = useState('');
  const [gatePassed, setGatePassed] = useState(false);
  const scene = sceneFor(plan, Math.max(size.width, 580), Math.max(size.height, 440));
  const enoughSpace = size.width >= 580 && size.height >= 440;
  const intended = scene.targets.find((target) => target.id === plan.intended)?.label ?? '';
  const retry = result !== null && currentPlan(session).index === plan.index;

  useEffect(() => {
    const element = board.current;

    const observer = new ResizeObserver(() => {
      if (element) {
        setSize({ width: element.clientWidth, height: element.clientHeight });
      }
    });

    if (element) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, []);
  useEffect(
    () => () => recorder.current?.finish('interrupted', null, 'The recording view was closed.'),
    [],
  );
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        recorder.current?.finish('interrupted', null, 'The trial was interrupted with Escape.');
      }
    };

    if (active) {
      document.addEventListener('keydown', keyboard);
    }

    return () => document.removeEventListener('keydown', keyboard);
  }, [active]);

  function begin(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== 'mouse') {
      setMessage('Use the mouse or touchpad selected for this session.');

      return;
    }

    if (disabled || active || !enoughSpace || !board.current || event.button !== 0) {
      return;
    }

    setMessage('');
    setGatePassed(false);

    try {
      recorder.current = recordTrial(
        board.current,
        plan,
        session.baseline,
        (trial) => {
          recorder.current = null;
          setActive(false);
          onActive(false);
          setResult(trial);
          onComplete(trial);
        },
        () => setGatePassed(true),
        { x: event.clientX, y: event.clientY },
        session.trials.filter(
          (trial) => trial.plan.phase === plan.phase && trial.plan.index === plan.index,
        ).length + 1,
        onStart,
      );
      setActive(true);
      onActive(true);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'Recording could not start. Download a backup and reload.',
      );
    }
  }

  const requiresGate = plan.mode === 'none' && plan.noneVariant !== 'away';

  let instruction =
    plan.mode === 'select'
      ? `Click Start, then select target ${intended}.`
      : plan.mode === 'free'
        ? 'Click Start, then select any target you like.'
        : requiresGate
          ? 'Click Start, pass through Gate, then click Finish. Do not select a target.'
          : 'Click Start, move naturally without clicking a target, then click Finish.';

  if (requiresGate && gatePassed) {
    instruction = 'Gate crossed. Click Finish without selecting a target.';
  }

  if (result) {
    instruction =
      result.quality?.eligible === true
        ? 'Recorded.'
        : retry
          ? 'Recording flagged. Try this task once more; the previous attempt is kept.'
          : 'Recording flagged and kept for review. Continue to the next task.';
  }

  return (
    <section className="study" aria-labelledby="study-heading">
      <div className="section-heading">
        <h2 id="study-heading">
          {plan.phase === 'warmup' ? 'Practice' : 'Trial'} {plan.index + 1} of{' '}
          {plan.phase === 'warmup' ? 12 : 120}
        </h2>
        <span className="meta">{plan.count} targets</span>
      </div>
      <div className="study-card">
        <output className="instruction" aria-live="polite">
          <span className={`status-dot ${active ? 'recording' : ''}`} aria-hidden="true" />
          <span>{instruction}</span>
        </output>
        <div
          ref={board}
          className="study-board"
          data-mode={plan.mode}
          data-intended={plan.intended ?? 'none'}
          data-active={active}
          data-approach={plan.approach}
          data-layout={plan.layout}
          data-start-kind={plan.startKind ?? ''}
          data-none-variant={plan.noneVariant ?? ''}
        >
          {enoughSpace ? (
            <>
              {scene.targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  className="study-target"
                  data-target={target.id}
                  data-hasta-label={target.label}
                  aria-label={`Target ${target.label}`}
                  disabled={!active}
                  style={{
                    left: target.rect.minX,
                    top: target.rect.minY,
                    width: target.rect.maxX - target.rect.minX,
                    height: target.rect.maxY - target.rect.minY,
                  }}
                  onClick={(event) => {
                    if (event.detail === 0) {
                      recorder.current?.finish(
                        'interrupted',
                        null,
                        'Keyboard selection is not a cursor recording.',
                      );
                    } else {
                      recorder.current?.finish('selected', target.id);
                    }
                  }}
                >
                  {target.label}
                </button>
              ))}
              {plan.mode === 'none' && (
                <>
                  {requiresGate && (
                    <div
                      data-gate
                      data-passed={gatePassed}
                      className="passage-gate"
                      aria-label={gatePassed ? 'Gate crossed' : 'Pass through this gate'}
                      style={{
                        left: scene.gate.minX,
                        top: scene.gate.minY,
                        width: scene.gate.maxX - scene.gate.minX,
                        height: scene.gate.maxY - scene.gate.minY,
                      }}
                    >
                      <span>{gatePassed ? '✓' : 'Gate'}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="finish-zone"
                    disabled={!active || (requiresGate && !gatePassed)}
                    style={{ left: scene.finish.x, top: scene.finish.y }}
                    onClick={(event) => {
                      if (event.detail === 0) {
                        recorder.current?.finish('interrupted', null, 'Finish using the pointer.');
                      } else {
                        recorder.current?.finish('none');
                      }
                    }}
                  >
                    Finish
                  </button>
                </>
              )}
              {result === null && (
                <div className="start-zone" style={{ left: scene.start.x, top: scene.start.y }}>
                  <Button
                    variant="outline"
                    className="start-button"
                    data-start
                    disabled={disabled || active}
                    onPointerUp={begin}
                    onClick={(event) => {
                      if (event.detail === 0) {
                        setMessage('Click Start using your mouse or touchpad.');
                      }
                    }}
                  >
                    Start
                  </Button>
                </div>
              )}
              {result && (
                <div className="result-actions">
                  {result.reason !== null && <p>{result.reason}</p>}
                  {result.quality?.flags.includes('instruction-mismatch') === true && (
                    <p>The selected target did not match the instruction.</p>
                  )}
                  <Button
                    disabled={disabled}
                    onClick={() => {
                      setPlan(currentPlan(session));
                      setResult(null);
                      setGatePassed(false);
                      setMessage('');
                    }}
                  >
                    {retry ? 'Retry task' : 'Next task'}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="board-empty">
              <span>
                Recording needs a 580 × 440 px area. Enlarge the window or use full screen.
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="board-footer">
        <span>
          {active ? 'Recording · 5 s limit · Esc interrupts' : 'Move naturally · 5 s per task'}
        </span>
        {active && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              recorder.current?.finish('interrupted', null, 'The task was interrupted manually.')
            }
          >
            Interrupt
          </Button>
        )}
      </div>
      <output className="inline-message">{message}</output>
    </section>
  );
}
