import { UnrecoverableError } from 'bullmq'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { loadAuthEnv } from '@photox/shared-config'

const uuid = z.string().uuid()

const jobRefs = {
  assetId: uuid,
  fileId: uuid,
  userId: uuid,
  // HMAC proof stamped by core's enqueue (or the worker's own re-enqueue) — optional so
  // directly-added test jobs still parse; the guard requires it on mutating /worker/* calls
  sig: z.string().optional(),
}

export const thumbnailJobSchema = z.object({
  ...jobRefs,
  size: z.enum(['sm', 'md', 'lg', 'xl']),
  // bounded defer counter the thumbnail processor sets when it re-enqueues a video job while
  // metadata is still pending — absent on upload payloads. Max mirrors MAX_METADATA_WAITS in
  // thumbnail.processor.ts (a shared const would cycle: that file already imports this one)
  metadataWaits: z.number().int().min(0).max(5).optional(),
})

// video/metadata/embedding/detection jobs carry only the three refs — one shared schema
export const assetRefsJobSchema = z.object({
  ...jobRefs,
})

// face jobs carry the same three refs
export const faceJobSchema = assetRefsJobSchema

export const clusterJobSchema = z.object({
  userId: uuid,
  sig: z.string().optional(),
})

// Admin account wipe: core enqueues it, the worker consumes and asks core to run the wipe
// (the worker has no DB/storage access). email is informational.
export const userDeleteJobSchema = z.object({
  userId: uuid,
  email: z.string().email(),
  backupPrefix: z.string().min(1),
  sig: z.string().optional(),
})

export type ThumbnailJob = z.infer<typeof thumbnailJobSchema>
export type AssetRefsJob = z.infer<typeof assetRefsJobSchema>
export type FaceJob = z.infer<typeof faceJobSchema>
export type ClusterJob = z.infer<typeof clusterJobSchema>
export type UserDeleteJob = z.infer<typeof userDeleteJobSchema>

export function parseJobData<T>(schema: z.ZodType<T>, data: unknown, queue: string): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new UnrecoverableError(`Invalid ${queue} job payload: ${detail}`)
  }
  // shared ingress: every processor routes through here, so a forged payload fails before any
  // CoreClient call or re-enqueue below
  verifyJobSig(parsed.data, queue)
  return parsed.data
}

// scope derivation mirrors core's enqueue stamp (and its guard's jobScopeFrom for asset routes):
// the asset/file/user id, first present — cluster jobs carry only the user id
export function jobScopeOf(data: {
  assetId?: unknown
  fileId?: unknown
  userId?: unknown
}): string | undefined {
  return [data.assetId, data.fileId, data.userId].find(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )
}

// the binding threaded back as X-Job-Signature/X-Job-Scope — scope stays identical to the
// verified scope so the guard recomputes the same HMAC
export function bindingOf(data: {
  assetId?: unknown
  fileId?: unknown
  userId?: unknown
  sig?: unknown
}): { sig: string; scope: string } | undefined {
  if (typeof data.sig !== 'string' || data.sig.length === 0) return undefined
  const scope = jobScopeOf(data)
  if (!scope) return undefined
  return { sig: data.sig, scope }
}

// H1: a Redis-forged job mints a delegated token for whatever userId it claims, so the payload
// itself must prove core enqueued it — HMAC(sub:scope) under WORKER_JWT_SECRET, same secret
// source and construction as core's guard. Fail-closed: the secret is required (compose always
// passes it; a missing one is a deployment error, not a pass-through).
export function verifyJobSig(data: unknown, queue: string): void {
  const secret = loadAuthEnv().WORKER_JWT_SECRET
  const record = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  const sub = record.userId
  const scope = jobScopeOf(record)
  const sig = record.sig
  const expected =
    typeof sub === 'string' && sub.length > 0 && scope !== undefined
      ? createHmac('sha256', secret).update(`${sub}:${scope}`).digest('hex')
      : undefined
  // length-checked first: timingSafeEqual throws on mismatched lengths
  const valid =
    typeof sig === 'string' &&
    expected !== undefined &&
    sig.length === expected?.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  if (!valid) throw new UnrecoverableError(`Missing or invalid job signature for ${queue} job`)
}

export function assertOwnership(
  job: { assetId: string; fileId: string; userId: string },
  loaded: {
    // structural shapes — CoreClient DTOs (the worker has no DB access, so no entity rows)
    record: { userId: string }
    asset: { userId: string; fileId?: string }
  },
): void {
  const mismatch =
    loaded.record.userId !== job.userId ||
    loaded.asset.userId !== job.userId ||
    loaded.asset.fileId !== job.fileId
  if (mismatch) {
    throw new UnrecoverableError(
      `Ownership mismatch: asset=${job.assetId} file=${job.fileId} user=${job.userId}`,
    )
  }
}
