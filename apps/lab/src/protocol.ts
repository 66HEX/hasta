import { random } from './plan.ts';
import type { Plan, Session, Trial } from './types.ts';

export const participants = Array.from(
  { length: 24 },
  (_, index) => `P${String(index + 1).padStart(2, '0')}`,
);

export const legacyParticipantsV3 = ['P01', 'P02', 'P03', 'P04', 'P05'];
export const WARMUP_TRIALS = 12;
export const MAIN_TRIALS = 120;
export const BLOCK_SIZE = 24;
export const PROTOCOL = 'hasta-intent-lib-v4';
export const STUDY_ID = 'intent-lib-v1' as const;

function shuffle<T>(items: T[], rng: () => number) {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(rng() * (index + 1));
    const a = items[index];
    const b = items[other];

    if (a !== undefined && b !== undefined) {
      items[index] = b;
      items[other] = a;
    }
  }

  return items;
}

export function studySeed(participant: string, number: number) {
  return (0x72ad351b ^ ((participants.indexOf(participant) + 1) * 7919) ^ (number * 104729)) >>> 0;
}

export function legacyCollectionPlanV3(
  seed: number,
  index: number,
  phase: 'warmup' | 'main',
): Plan {
  const warmup = phase === 'warmup';
  const block = warmup ? 0 : Math.floor(index / BLOCK_SIZE);
  const rng = random(seed ^ ((block + 1) * 0x45d9f3b) ^ (warmup ? 0x1a34b765 : 0));
  const directions = ['left', 'right', 'top', 'bottom'] as const;
  const layouts = ['grid', 'rows', 'scatter'] as const;
  const passages = ['through', 'above', 'below'] as const;
  const plans: Plan[] = [];

  for (const [countIndex, count] of [4, 8, 12].entries()) {
    const labels = shuffle(
      Array.from({ length: count }, (_, i) => String(i)),
      random(seed ^ (count * 127)),
    );

    let selected = 0;
    const offset = (block + countIndex + (seed % 4)) % 4;

    for (let slot = 0; slot < (warmup ? 4 : 8); slot++) {
      const direction = slot % 4;

      const negative = warmup
        ? direction === offset
        : slot === offset || slot === 4 + ((offset + 1) % 4);

      const intended = negative ? null : (labels[(block * 6 + selected++) % count] ?? '0');
      plans.push({
        index,
        seed: Math.floor(rng() * 4294967296),
        count,
        mode: negative ? 'none' : 'select',
        intended,
        layout: layouts[(slot + block + countIndex) % 3] ?? 'grid',
        phase,
        approach: directions[direction] ?? 'left',
        passage: passages[(block + countIndex + Math.floor(slot / 4)) % 3] ?? 'through',
      });
    }
  }

  const result = shuffle(plans, rng)[index % (warmup ? WARMUP_TRIALS : BLOCK_SIZE)];

  if (!result) {
    throw new RangeError('The trial index is invalid.');
  }

  return result;
}

export function collectionPlan(seed: number, index: number, phase: 'warmup' | 'main'): Plan {
  const warmup = phase === 'warmup';
  const block = warmup ? 0 : Math.floor(index / BLOCK_SIZE);
  const rng = random(seed ^ ((block + 1) * 0x51f2c9a3) ^ (warmup ? 0x1a34b765 : 0));
  const directions = ['left', 'right', 'top', 'bottom'] as const;
  const layouts = ['grid', 'navbar', 'sidebar', 'cards', 'cluster'] as const;
  const passages = ['through', 'above', 'below'] as const;
  const startKinds = ['far', 'medium', 'near'] as const;
  const plans: Plan[] = [];
  let blockCursor = 0;

  for (const [countIndex, count] of [4, 8, 12].entries()) {
    const labels = shuffle(
      Array.from({ length: count }, (_, i) => String(i)),
      random(seed ^ (count * 127)),
    );

    let selected = 0;
    const offset = (block + countIndex + (seed % 4)) % 4;
    const slots = warmup ? 4 : 8;

    for (let slot = 0; slot < slots; slot++) {
      const direction = slot % 4;
      let mode: 'select' | 'free' | 'none' = 'select';
      let noneVariant: 'gate' | 'away' | undefined;

      if (warmup) {
        if (direction === offset) {
          mode = 'none';
          noneVariant = countIndex % 2 === 0 ? 'gate' : 'away';
        } else if (direction === (offset + 1) % 4) {
          mode = 'free';
        }
      } else if (slot === offset) {
        mode = 'none';
        noneVariant = 'gate';
      } else if (slot === 4 + ((offset + 1) % 4)) {
        mode = 'none';
        noneVariant = 'away';
      } else if (slot === (offset + 2) % 4) {
        mode = 'free';
      }

      const intended = mode === 'select' ? (labels[(block * 5 + selected++) % count] ?? '0') : null;

      // Exact balance across the 5 blocks (120 trials): 24 of each of the 5 layouts, 40 of each startKind
      const globalSlot = block * 24 + blockCursor++;
      const layout = layouts[(globalSlot + (seed % 5)) % 5] ?? 'grid';
      const startKind = startKinds[(globalSlot + (seed % 3)) % 3] ?? 'medium';

      const plan: Plan = {
        index,
        seed: Math.floor(rng() * 4294967296),
        count,
        mode,
        intended,
        layout,
        phase,
        approach: directions[direction] ?? 'left',
        passage: passages[(block + countIndex + Math.floor(slot / 4)) % 3] ?? 'through',
        startKind,
      };

      if (noneVariant !== undefined) {
        plan.noneVariant = noneVariant;
      }

      plans.push(plan);
    }
  }

  const result = shuffle(plans, rng)[index % (warmup ? WARMUP_TRIALS : BLOCK_SIZE)];

  if (!result) {
    throw new RangeError('The trial index is invalid.');
  }

  return result;
}

export function currentPlan(session: Session) {
  const phase = session.collection?.phase === 'warmup' ? 'warmup' : 'main';
  const index = phase === 'warmup' ? (session.collection?.warmupNext ?? 0) : session.nextIndex;

  return collectionPlan(session.seed, index, phase);
}

export function compatible(session: Session) {
  return (
    session.protocolVersion === 4 &&
    session.collection?.studyId === STUDY_ID &&
    session.provenance.sourceHash === HASTA_BUILD.sourceHash &&
    session.provenance.collectorHash === HASTA_BUILD.collectorHash
  );
}

export function recordCompletion(session: Session, trial: Trial): Session {
  const collection = session.collection;

  if (!collection) {
    throw new Error('This recording uses an earlier protocol.');
  }

  const previousAttempts = session.trials.filter(
    (item) => item.plan.phase === trial.plan.phase && item.plan.index === trial.plan.index,
  );

  const retry = trial.quality?.eligible !== true && previousAttempts.length === 0;
  const main = trial.plan.phase === 'main';

  return {
    ...session,
    nextIndex: session.nextIndex + (main && !retry ? 1 : 0),
    collection: { ...collection, warmupNext: collection.warmupNext + (!main && !retry ? 1 : 0) },
    trials: [...session.trials, trial],
  };
}

export function counts(session: Session) {
  const main = session.trials.filter((trial) => trial.plan.phase === 'main');

  const usable = new Set(
    main.filter((trial) => trial.quality?.eligible === true).map((trial) => trial.plan.index),
  ).size;

  const flagged = main.filter((trial) => (trial.quality?.flags.length ?? 0) > 0).length;

  return { usable, flagged, attempts: main.length };
}
