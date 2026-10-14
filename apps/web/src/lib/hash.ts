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

/**
 * Upper bound for one file's hash. Any stall — hung worker, lost onmessage, a queued call
 * stuck behind a stalled one — fails open to null so the upload lane always proceeds.
 */
export const HASH_TIMEOUT_MS = 60_000

// Single shared worker: every hashFile call chains onto `queue`, so at most one file is
// hashed at a time and construction races are impossible. Each chained `run` is bounded by
// HASH_TIMEOUT_MS (see hashFile), so a stalled call releases the queue instead of deadlocking
// every concurrent hashFile caller behind it.
let worker: Worker | null = null
let nextHashId = 0
let queue: Promise<void> = Promise.resolve()
const pending = new Map<string, PendingHash>()

/** Test-only worker-constructor override (bypasses the Vite ?worker import). */
let workerCtorOverride: (new () => Worker) | null = null

/** Points hashFile at a fake worker constructor; pass null to restore the ?worker import. */
export function setWorkerConstructorForTests(ctor: (new () => Worker) | null): void {
  workerCtorOverride = ctor
  worker = null
}

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

function attachWorker(created: Worker): Worker {
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
}

async function getWorker(): Promise<Worker | null> {
  if (worker) return worker
  if (workerCtorOverride) {
    try {
      return attachWorker(new workerCtorOverride())
    } catch {
      return null
    }
  }
  // Fail open where workers are unavailable (SSR, old browsers, jsdom tests).
  if (typeof Worker === 'undefined') return null
  try {
    // Vite ?worker import: bundled as a separate worker script. Any load/construct
    // failure must never break uploads, so every error path below resolves null.
    const { default: HashWorker } = await import('../workers/hash.worker.ts?worker')
    return attachWorker(new HashWorker())
  } catch {
    return null
  }
}

/**
 * Hashes a file through the shared worker pool, reporting 0-100 progress. Resolves null
 * on any worker failure or after `timeoutMs` without a result — callers treat null as a
 * fail-open miss (upload as usual). Never rejects; never pends past `timeoutMs` (plus one
 * queue turn per earlier caller, each likewise bounded).
 */
export function hashFile(
  file: File,
  onProgress?: ProgressCallback,
  timeoutMs: number = HASH_TIMEOUT_MS,
): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    let timedOut = false
    let id: string | null = null
    const work = (async (): Promise<string | null> => {
      const w = await getWorker()
      if (!w || timedOut) return null
      id = `hash-${++nextHashId}-${Date.now()}`
      const jobId: string = id
      const result = new Promise<string | null>((resolve) => {
        pending.set(jobId, { resolve, onProgress })
      })
      try {
        w.postMessage({ id: jobId, file })
      } catch {
        if (id) pending.delete(id)
        return null
      }
      return result
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true
        if (id) pending.delete(id)
        resolve(null)
      }, timeoutMs)
    })
    try {
      return await Promise.race([work, timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
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
