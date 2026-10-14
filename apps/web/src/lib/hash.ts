import { sha256 } from '@noble/hashes/sha2'
import type { HashWorkerMessage } from '../workers/hash.worker'

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/**
 * Pure incremental whole-file SHA-256 over ordered chunks. Must equal the server's
 * whole-file hex digest (NOT hash-of-hashes); chunk boundaries must not change the result.
 */
export function hashBytes(chunks: Uint8Array[]): string {
  const hasher = sha256.create()
  for (const chunk of chunks) hasher.update(chunk)
  return toHex(hasher.digest())
}

type ProgressCallback = (pct: number) => void

interface PendingHash {
  resolve: (checksum: string | null) => void
  onProgress?: ProgressCallback
}

// Single shared worker: every hashFile call chains onto `queue`, so at most one file is
// hashed at a time and construction races are impossible.
let worker: Worker | null = null
let nextHashId = 0
let queue: Promise<void> = Promise.resolve()
const pending = new Map<string, PendingHash>()

function routeMessage(event: MessageEvent): void {
  const data = event.data as HashWorkerMessage
  const entry = pending.get(data.id)
  if (!entry) return
  if (data.type === 'progress') {
    entry.onProgress?.(data.progress)
  } else {
    pending.delete(data.id)
    entry.resolve(data.type === 'done' ? data.checksum : null)
  }
}

function failAllPending(): void {
  for (const [id, entry] of pending) {
    pending.delete(id)
    entry.resolve(null)
  }
}

async function getWorker(): Promise<Worker | null> {
  // Fail open where workers are unavailable (SSR, old browsers, jsdom tests).
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    // Vite ?worker import: bundled as a separate worker script. Any load/construct
    // failure must never break uploads, so every error path below resolves null.
    const { default: HashWorker } = await import('../workers/hash.worker.ts?worker')
    const created = new HashWorker()
    created.onmessage = routeMessage
    created.onerror = () => {
      failAllPending()
      try {
        created.terminate()
      } catch {
        // ignore teardown errors
      }
      if (worker === created) worker = null
    }
    worker = created
    return created
  } catch {
    return null
  }
}

/**
 * Hashes a file through the shared worker pool, reporting 0-100 progress. Resolves null
 * on any worker failure — callers treat null as a fail-open miss (upload as usual).
 */
export function hashFile(file: File, onProgress?: ProgressCallback): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    const w = await getWorker()
    if (!w) return null
    const id = `hash-${++nextHashId}-${Date.now()}`
    const result = new Promise<string | null>((resolve) => {
      pending.set(id, { resolve, onProgress })
    })
    try {
      w.postMessage({ id, file })
    } catch {
      pending.delete(id)
      return null
    }
    return result
  }
  const chained = queue.then(run, run)
  queue = chained.then(
    () => undefined,
    () => undefined,
  )
  return chained
}

/** Tears down the shared worker, releasing queued callers with null. Test-only hook. */
export function terminate(): void {
  try {
    worker?.terminate()
  } catch {
    // ignore teardown errors
  }
  worker = null
  failAllPending()
  queue = Promise.resolve()
}
