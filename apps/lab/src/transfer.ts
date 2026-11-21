import { checksum } from './checksum.ts';
import { importSession, readSession } from './data.ts';
import { PROTOCOL } from './protocol.ts';
import type { Session } from './types.ts';

const MAX_BYTES = 256 * 1024 * 1024;

export interface Backup {
  blob: Blob;
  filename: string;
  sha256: string;
  trialCount: number;
}

export async function readBackup(file: Blob) {
  if (file.size > MAX_BYTES) {
    throw new Error('The backup exceeds 256 MB.');
  }

  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const compressed = header[0] === 0x1f && header[1] === 0x8b;

  const stream = compressed
    ? file.stream().pipeThrough(new DecompressionStream('gzip'))
    : file.stream();

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;

  for (;;) {
    // Read sequentially so the uncompressed size limit also protects compressed imports
    // oxlint-disable-next-line no-await-in-loop -- Stream reads depend on the preceding chunk
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    bytes += value.byteLength;

    if (bytes > MAX_BYTES) {
      // oxlint-disable-next-line no-await-in-loop -- Stop decoding immediately at the size limit
      await reader.cancel();
      throw new Error('The uncompressed backup exceeds 256 MB.');
    }

    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());

  return importSession(chunks.join(''));
}

export async function makeBackup(session: Session): Promise<Backup> {
  const validated = readSession(session);
  const payload = JSON.stringify(validated);
  const sha256 = await checksum(payload);

  const contents =
    session.protocolVersion === 4
      ? JSON.stringify({ schemaVersion: 2, protocol: PROTOCOL, sha256, session: validated })
      : session.protocolVersion === 3
        ? JSON.stringify({
            schemaVersion: 2,
            protocol: 'hasta-intent-5p-v3',
            sha256,
            session: validated,
          })
        : JSON.stringify({
            schemaVersion: 1,
            protocol: `hasta-intent-pilot-v${session.protocolVersion}`,
            session: validated,
          });

  const plain = new Blob([contents], { type: 'application/json' });

  if (plain.size > MAX_BYTES) {
    throw new Error(
      'This session exceeds 256 MB. Keep the previous block backup and contact the coordinator.',
    );
  }

  const blob = await new Response(plain.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  const restored = await readBackup(blob);

  if ((await checksum(JSON.stringify(restored))) !== sha256) {
    throw new Error('The backup could not be verified.');
  }

  const filename = session.collection
    ? `${session.collection.studyId}-${session.participant}-s${session.collection.number}-${session.collection.recordingId.slice(0, 8)}-${session.trials.length}.json.gz`
    : `hasta-lab-${session.id}.json.gz`;

  return { blob, filename, sha256, trialCount: session.trials.length };
}

export function downloadBackup(backup: Backup) {
  const url = URL.createObjectURL(backup.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = backup.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
