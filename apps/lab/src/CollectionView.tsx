import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import { compatible, counts } from './protocol';
import { Study } from './Study';
import type { Backup } from './transfer';
import type { Session, Trial } from './types';

export function CollectionView({
  session,
  disabled,
  onActive,
  onComplete,
  onChange,
  onBackup,
  onStart,
  onRestart,
}: {
  session: Session;
  disabled: boolean;
  onActive: (value: boolean) => void;
  onComplete: (trial: Trial) => void;
  onChange: (session: Session) => Promise<boolean>;
  onBackup: () => Promise<Backup | null>;
  onStart: (trial: Trial) => void;
  onRestart: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [download, setDownload] = useState<Backup | null>(null);
  const [rested, setRested] = useState(false);
  const collection = session.collection;

  if (!collection || !compatible(session)) {
    return (
      <div className="collection-step">
        <h2>Earlier recording version</h2>
        <p>You can download this session. Open a new session to use the current study.</p>
      </div>
    );
  }

  if (collection.phase === 'instructions') {
    return (
      <div className="collection-step">
        <h2>
          Session {collection.number} of 2 · {session.participant}
        </h2>
        <ol>
          <li>
            Read the target letter before clicking Start. Move naturally, then click that target.
          </li>
          <li>
            For a gate task, pass through the marked Gate and click Finish without selecting a
            target.
          </li>
          <li>
            Use the same {session.device === 'mouse' ? 'mouse' : 'touchpad'}, computer, and pointer
            settings in both sessions. Keep browser zoom at 100%.
          </li>
          <li>
            Keep this tab visible. Escape interrupts a task. Take breaks when prompted; do not rush
            to beat the time limit.
          </li>
        </ol>
        <p>
          12 practice tasks, then 5 blocks of 24 tasks. Practice is stored separately. The second
          session should be on another day.
        </p>
        <label className="confirmation">
          <Checkbox checked={confirmed} onCheckedChange={setConfirmed} />
          <span>
            I am {session.participant} and I am using a{' '}
            {session.device === 'mouse' ? 'mouse' : 'touchpad'}.
          </span>
        </label>
        <Button
          disabled={disabled || !confirmed}
          onClick={() => {
            void onChange({ ...session, collection: { ...collection, phase: 'warmup' } });
          }}
        >
          Start practice
        </Button>
      </div>
    );
  }

  if (!confirmed) {
    return (
      <div className="collection-step">
        <h2>
          Resume session {collection.number} · {session.participant}
        </h2>
        <p>Use the same computer, pointer settings, and browser zoom (100%) as before.</p>
        <Button disabled={disabled} onClick={() => setConfirmed(true)}>
          I am {session.participant}, using a {session.device === 'mouse' ? 'mouse' : 'touchpad'}
        </Button>
      </div>
    );
  }

  if (collection.phase === 'warmup' && collection.warmupNext >= 12) {
    const usable = new Set(
      session.trials
        .filter((trial) => trial.plan.phase === 'warmup' && trial.quality?.eligible === true)
        .map((trial) => trial.plan.index),
    ).size;

    const gateSucceeded = session.trials.some(
      (trial) =>
        trial.plan.phase === 'warmup' &&
        trial.plan.mode === 'none' &&
        trial.quality?.eligible === true,
    );

    const passed = usable >= 8 && gateSucceeded;

    return (
      <div className="collection-step">
        <h2>{passed ? 'Practice complete' : 'Check your setup'}</h2>
        <p>{usable} of 12 practice tasks have usable recordings.</p>
        {passed ? (
          <>
            <p>Move naturally in the next blocks. The task types remain the same.</p>
            <Button
              disabled={disabled}
              onClick={() => {
                void onChange({ ...session, collection: { ...collection, phase: 'main' } });
              }}
            >
              Begin collection
            </Button>
          </>
        ) : (
          <>
            <p>
              Practice needs at least 8 usable tasks and a completed gate task. Read the
              instructions again. Your previous recordings will be kept.
            </p>
            <Button disabled={disabled} onClick={onRestart}>
              Restart practice
            </Button>
          </>
        )}
      </div>
    );
  }

  const boundary =
    collection.phase === 'main' &&
    session.nextIndex > 0 &&
    session.nextIndex % 24 === 0 &&
    collection.acknowledgedBoundary < session.nextIndex;

  if (boundary) {
    const complete = session.nextIndex === session.total;
    const summary = counts(session);
    const currentDownload = download?.trialCount === session.trials.length ? download : null;

    return (
      <div className="collection-step">
        <h2>
          {complete ? 'Collection finished' : `Block ${session.nextIndex / 24} of 5 complete`}
        </h2>
        <p>
          {summary.usable} usable tasks so far. {summary.flagged} attempts are flagged for review;
          all recordings are retained.
        </p>
        <p>
          {complete
            ? 'Download the final backup and send it to the study coordinator.'
            : 'Take a short break. Download a backup before continuing.'}
        </p>
        <Button
          disabled={disabled}
          onClick={() => {
            void (async () => {
              setDownload(await onBackup());
              setRested(false);
            })();
          }}
        >
          Download {complete ? 'final backup' : 'block backup'}
        </Button>
        {currentDownload && (
          <>
            <p className="backup-name">{currentDownload.filename}</p>
            <label className="confirmation">
              <Checkbox checked={rested} onCheckedChange={setRested} />
              <span>
                {complete
                  ? 'I have saved the file and will send it to the coordinator.'
                  : 'I have saved the file and taken a break.'}
              </span>
            </label>
            <Button
              disabled={disabled || !rested}
              onClick={() => {
                void (async () => {
                  await onChange({
                    ...session,
                    collection: {
                      ...collection,
                      acknowledgedBoundary: session.nextIndex,
                      exports: [
                        ...collection.exports,
                        {
                          at: new Date().toISOString(),
                          sha256: currentDownload.sha256,
                          trialCount: currentDownload.trialCount,
                        },
                      ],
                    },
                  });
                  setDownload(null);
                  setRested(false);
                })();
              }}
            >
              {complete ? 'Finish session' : 'Continue to next block'}
            </Button>
          </>
        )}
      </div>
    );
  }

  if (session.nextIndex >= session.total) {
    return (
      <div className="collection-step">
        <h2>Session complete</h2>
        <p>
          Send the downloaded file to the study coordinator. Keep a copy until they confirm receipt.
        </p>
        {collection.number === 1 && (
          <p>Return for session 2 on another day, using the same participant ID and device.</p>
        )}
        <Button
          disabled={disabled}
          onClick={() => {
            void onBackup();
          }}
        >
          Download backup again
        </Button>
      </div>
    );
  }

  return (
    <Study
      key={collection.phase}
      session={session}
      disabled={disabled}
      onActive={onActive}
      onComplete={onComplete}
      onStart={onStart}
    />
  );
}
