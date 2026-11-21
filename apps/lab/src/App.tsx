import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PreferencesProvider, usePreferences } from '@/lib/preferences';

import { CollectionView } from './CollectionView';
import { FieldSelect } from './controls';
import {
  checkStorage,
  clearJournal,
  journalTrial,
  loadSessions,
  recoverTrial,
  saveSession,
} from './data';
import {
  compatible,
  counts,
  participants,
  recordCompletion,
  STUDY_ID,
  studySeed,
} from './protocol';
import { downloadBackup, makeBackup, readBackup } from './transfer';
import type { Backup } from './transfer';
import type { Session, Trial } from './types';
import { useCollectorLock } from './useCollectorLock';

function stored(key: string) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function initialParticipant() {
  const value =
    new URLSearchParams(location.search).get('participant') ?? stored('hasta.lab.participant');

  return participants.includes(value) ? value : '';
}

function Laboratory() {
  const { dark, toggleTheme } = usePreferences();
  const lock = useCollectorLock();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState(() => stored('hasta.lab.session'));
  const [participant, setParticipant] = useState(initialParticipant);

  const [number, setNumber] = useState(
    new URLSearchParams(location.search).get('session') === '2' ? '2' : '1',
  );

  const [device, setDevice] = useState('');
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Checking storage…');
  const [unsaved, setUnsaved] = useState<Session | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingWrite = useRef(false);
  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const disabled = active || busy || unsaved !== null || !ready || lock !== 'owned';

  useEffect(() => {
    let mounted = true;

    async function open() {
      if (lock !== 'owned') {
        return;
      }

      try {
        if (
          !window.isSecureContext ||
          !('PointerEvent' in window) ||
          !('CompressionStream' in window)
        ) {
          throw new Error('Use an up-to-date desktop browser over HTTPS or localhost.');
        }

        await checkStorage();
        const loaded = await loadSessions();
        const recovered = await recoverTrial(loaded.sessions);

        if (mounted) {
          setSessions(recovered);
          setSelectedId((previous) =>
            recovered.some((session) => session.id === previous)
              ? previous
              : (recovered[0]?.id ?? ''),
          );
          setReady(true);
          setStatus('Saved on this device');

          if (loaded.rejected > 0) {
            setError(
              `${loaded.rejected} unreadable saved sessions were retained. Contact the coordinator before collecting more data.`,
            );
            setReady(false);
          }
        }
      } catch (cause) {
        if (mounted) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Storage check failed. Reload before recording.',
          );
          setStatus('Recording unavailable');
        }
      }
    }

    void open();

    return () => {
      mounted = false;
    };
  }, [lock]);

  function remember(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      setReady(false);
      setError('Local storage stopped working. Download a backup before reloading.');
    }
  }

  function chooseSession(id: string) {
    remember('hasta.lab.session', id);
    setSelectedId(id);
  }

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    if (active || busy || unsaved !== null) {
      window.addEventListener('beforeunload', protect);
    }

    return () => window.removeEventListener('beforeunload', protect);
  }, [active, busy, unsaved]);

  function showSession(session: Session) {
    setSessions((previous) => [session, ...previous.filter((item) => item.id !== session.id)]);
    chooseSession(session.id);
  }

  async function persist(next: Session, retry = false) {
    if (pendingWrite.current) {
      return false;
    }

    pendingWrite.current = true;
    setBusy(true);
    setStatus('Saving…');
    const updated = { ...next };

    if (next.collection && !retry) {
      updated.collection = { ...next.collection, revision: next.collection.revision + 1 };
    }

    showSession(updated);

    try {
      await saveSession(updated);
      clearJournal();
      setUnsaved(null);
      setError('');
      setStatus('Saved on this device');

      return true;
    } catch (cause) {
      setUnsaved(updated);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Saving failed. Download a backup, then retry saving.',
      );
      setStatus('Not saved');

      return false;
    } finally {
      pendingWrite.current = false;
      setBusy(false);
    }
  }

  async function createSession(force = false, previous: Session | null = null) {
    const id = previous?.participant ?? participant;
    const sessionNumber = previous?.collection?.number ?? (number === '2' ? 2 : 1);
    const inputDevice = previous?.device ?? device;

    if (disabled || !participants.includes(id) || !['mouse', 'trackpad'].includes(inputDevice)) {
      return;
    }

    const existing = sessions.find(
      (session) =>
        session.participant === id &&
        session.collection?.number === sessionNumber &&
        compatible(session),
    );

    const previousDevice = sessions.find(
      (session) => session.participant === id && compatible(session),
    )?.device;

    if (previousDevice !== undefined && previousDevice !== inputDevice) {
      setError(
        `Use the same ${previousDevice === 'mouse' ? 'mouse' : 'touchpad'} as your earlier session. Change Input device to match.`,
      );

      return;
    }

    if (existing && !force) {
      setError('');
      chooseSession(existing.id);

      return;
    }

    const recordingId = crypto.randomUUID();

    const session: Session = {
      id: recordingId,
      protocolVersion: 4,
      // oxlint-disable-next-line react/purity -- Session creation runs only from setup and restart button handlers
      createdAt: new Date().toISOString(),
      participant: id,
      device: inputDevice === 'trackpad' ? 'trackpad' : 'mouse',
      seed: studySeed(id, sessionNumber),
      total: 120,
      nextIndex: 0,
      provenance: { ...HASTA_BUILD },
      environment: {
        userAgent: navigator.userAgent,
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
        coalesced: 'getCoalescedEvents' in PointerEvent.prototype,
        automated: navigator.webdriver,
      },
      baseline: { horizonMs: 160, stableForMs: 30, maxSampleAgeMs: 100, once: true },
      trials: [],
      collection: {
        studyId: STUDY_ID,
        recordingId,
        number: sessionNumber,
        phase: 'instructions',
        warmupNext: 0,
        acknowledgedBoundary: 0,
        revision: 0,
        exports: [],
      },
    };

    await persist(session);
  }

  function completeTrial(trial: Trial) {
    if (selected) {
      void persist(recordCompletion(selected, trial));
    }
  }

  async function backup(): Promise<Backup | null> {
    if (!selected || active || busy) {
      return null;
    }

    setBusy(true);
    setStatus('Checking backup…');

    try {
      const result = await makeBackup(selected);
      downloadBackup(result);
      setStatus('Download requested');

      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The backup could not be created.');

      return null;
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);

    try {
      const session = await readBackup(file);
      const imported = { ...session, id: crypto.randomUUID() };

      if (imported.collection) {
        imported.collection = { ...imported.collection, revision: 0 };
      }

      setBusy(false);
      await persist(imported);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The backup could not be read.');
    } finally {
      setBusy(false);
    }
  }

  const progress = selected ? counts(selected) : null;

  return (
    <>
      <a className="skip-link" href="#lab-content">
        Skip to the lab
      </a>
      <div className="page-frame lab-frame">
        <div className="page-column lab-column">
          <header className="layout-band lab-header">
            <div className="lab-brand-group">
              <a className="lab-brand type-display" href="#lab-content">
                <img src="/logo.svg" alt="" aria-hidden="true" className="h-4 w-auto dark:invert" />
                <h1>hasta</h1>
              </a>
              <Badge variant="secondary">lab</Badge>
            </div>
            <div className="header-tools">
              <output className="save-status">{active ? 'Recording' : status}</output>
              <Button
                variant="ghost"
                size="icon"
                disabled={active}
                aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
                onClick={toggleTheme}
              >
                <Icon name={dark ? 'sun' : 'moon'} />
              </Button>
            </div>
          </header>
          {lock === 'blocked' && (
            <div className="error-banner" role="alert">
              Close other collection tabs, then reload this page. Only one tab can record at a time.
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              {unsaved && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void persist(unsaved, true);
                  }}
                >
                  Retry saving
                </Button>
              )}
            </div>
          )}
          <main id="lab-content" className="workspace" tabIndex={-1}>
            <aside className="session-panel" aria-label="Session settings">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void createSession();
                }}
              >
                <h2>Participant setup</h2>
                <fieldset disabled={disabled}>
                  <FieldSelect
                    id="participant"
                    label="Participant ID"
                    value={participant}
                    onChange={(id) => {
                      setParticipant(id);
                      remember('hasta.lab.participant', id);
                    }}
                    disabled={disabled}
                    options={[
                      { value: '', label: 'Choose your assigned ID' },
                      ...participants.map((id) => ({ value: id, label: id })),
                    ]}
                  />
                  <FieldSelect
                    id="session-number"
                    label="Session"
                    value={number}
                    onChange={setNumber}
                    disabled={disabled}
                    options={[
                      { value: '1', label: '1 of 2' },
                      { value: '2', label: '2 of 2' },
                    ]}
                  />
                  <FieldSelect
                    id="device"
                    label="Input device"
                    value={device}
                    onChange={setDevice}
                    disabled={disabled}
                    options={[
                      { value: '', label: 'Choose your device' },
                      { value: 'mouse', label: 'Mouse' },
                      { value: 'trackpad', label: 'Touchpad' },
                    ]}
                  />
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={disabled || !participant || !device}
                  >
                    Open session
                  </Button>
                </fieldset>
              </form>
              <div className="saved-sessions">
                <h2>Recordings</h2>
                {sessions.length > 0 ? (
                  <FieldSelect
                    id="session-picker"
                    label="Saved session"
                    value={selectedId}
                    onChange={chooseSession}
                    disabled={disabled}
                    options={sessions.map((session) => ({
                      value: session.id,
                      label: `${session.participant}${session.collection ? ` · session ${session.collection.number}` : ''}`,
                      detail: `${session.nextIndex}/${session.total} trials · ${new Date(session.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
                    }))}
                  />
                ) : (
                  <p className="muted">No saved sessions.</p>
                )}
                {selected && (
                  <>
                    <div className="session-progress">
                      <span>
                        {selected.nextIndex} / {selected.total} tasks
                      </span>
                    </div>
                    <progress
                      value={selected.nextIndex}
                      max={selected.total}
                      aria-label="Collection progress"
                    />
                    {selected.collection && (
                      <p className="muted">
                        {progress?.usable} usable · {progress?.flagged} flagged attempts
                      </p>
                    )}
                  </>
                )}
                <div className="file-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={active || busy || !selected}
                    onClick={() => {
                      void backup();
                    }}
                  >
                    Download backup
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => fileInput.current?.click()}
                  >
                    Import backup
                  </Button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Recording backup file"
                  accept=".json,.gz,application/json,application/gzip"
                  onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (file) {
                      void importFile(file);
                    }

                    event.target.value = '';
                  }}
                />
              </div>
            </aside>
            <div className="work-area">
              {selected ? (
                <CollectionView
                  key={selected.id}
                  session={selected}
                  disabled={disabled}
                  onActive={setActive}
                  onComplete={completeTrial}
                  onChange={persist}
                  onBackup={backup}
                  onRestart={() => {
                    void createSession(true, selected);
                  }}
                  onStart={(trial) => journalTrial(selected.id, trial)}
                />
              ) : (
                <div className="collection-step">
                  <h2>Choose your assigned ID and device.</h2>
                  <p>
                    Each session includes 12 practice tasks and 120 recorded tasks, with a break
                    after every 24 tasks. Recordings stay on this device until you download and send
                    a backup.
                  </p>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export default function App() {
  return (
    <PreferencesProvider>
      <Laboratory />
    </PreferencesProvider>
  );
}
