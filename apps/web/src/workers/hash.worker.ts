import { sha256 } from '@noble/hashes/sha2.js';

/** 8 MiB read slices: incremental whole-file SHA-256 (NOT hash-of-hashes). */
export const HASH_CHUNK_SIZE = 8 * 1024 * 1024;

export interface HashWorkerRequest {
  id: string;
  file: File;
}

export interface HashProgressMessage {
  id: string;
  type: 'progress';
  progress: number;
}

export interface HashDoneMessage {
  id: string;
  type: 'done';
  checksum: string;
}

export interface HashErrorMessage {
  id: string;
  type: 'error';
  error: string;
}

export type HashWorkerMessage = HashProgressMessage | HashDoneMessage | HashErrorMessage;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

// Vite ?worker entry: hash.ts constructs this via `import '../workers/hash.worker.ts?worker'`.
self.onmessage = async (event: MessageEvent<HashWorkerRequest>): Promise<void> => {
  const { id, file } = event.data;
  // DOM lib has no DedicatedWorkerGlobalScope (that lives in lib.webworker); the worker
  // scope only needs postMessage here, so cast structurally instead of switching libs.
  const scope = self as unknown as { postMessage(message: HashWorkerMessage): void };
  const post = (message: HashWorkerMessage): void => {
    scope.postMessage(message);
  };
  try {
    const hasher = sha256.create();
    const total = file.size;
    let offset = 0;
    if (total === 0) post({ id, type: 'progress', progress: 100 });
    while (offset < total) {
      const end = Math.min(offset + HASH_CHUNK_SIZE, total);
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      hasher.update(bytes);
      offset = end;
      post({ id, type: 'progress', progress: Math.round((offset / total) * 100) });
    }
    post({ id, type: 'done', checksum: toHex(hasher.digest()) });
  } catch (error) {
    post({ id, type: 'error', error: (error as Error).message ?? 'Hash failed' });
  }
};
