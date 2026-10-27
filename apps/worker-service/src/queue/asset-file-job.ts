import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import sharp from 'sharp'
import type { z } from 'zod'
import type { Asset, FileRecord } from '@photox/shared-types'
import { LocalStorageService } from '@photox/shared-config'
import { assertOwnership, bindingOf, parseJobData } from './job-schemas'
import type { CoreClient, MetadataPatch } from '../core/core-client.service'

export interface AssetFileJobContext<T> {
  data: T
  record: FileRecord
  asset: Asset
  filePath: string
}

export interface AssetFileJobSpec<
  T extends { assetId: string; fileId: string; userId: string; sig?: string },
> {
  queue: string
  schema: z.ZodType<T>
  // human label for the start/skip/failure logs, e.g. 'Embedding'
  label: string
  // appended to the start log, e.g. ', size=sm'
  detail?: (data: T) => string
  // failure-log prefix when it differs from `label` (metadata: 'Metadata failed')
  failureLabel?: string
  // error substrings that mean "model weights not provisioned" — warn + no retry
  missingModelMarkers: string[]
  // runs after the fetch + ownership check, before the body; true ends the job (thumbnail defer)
  beforeBody?: (ctx: AssetFileJobContext<T>) => Promise<boolean>
  body: (ctx: AssetFileJobContext<T>) => Promise<void>
  // runs on both the missing-model skip and a real failure — e.g. patch a status to failed
  onFailure?: (ctx: {
    userId: string
    assetId: string
    message: string
    sig?: string
  }) => Promise<void>
}

export async function runAssetFileJob<
  T extends { assetId: string; fileId: string; userId: string; sig?: string },
>(
  deps: { core: CoreClient; storage: LocalStorageService; logger: Logger },
  job: Job<T>,
  spec: AssetFileJobSpec<T>,
): Promise<void> {
  const data = parseJobData(spec.schema, job.data, spec.queue)
  const { assetId, fileId, userId } = data
  const { core, storage, logger } = deps
  const binding = bindingOf(data)
  const failureLabel = spec.failureLabel ?? spec.label

  logger.log(
    `Processing ${spec.label}: asset=${assetId}${spec.detail ? `, ${spec.detail(data)}` : ''}`,
  )

  const record = await core.getFile(userId, fileId, binding)
  const asset = await core.getAsset(userId, assetId, binding)
  assertOwnership({ assetId, fileId, userId }, { record, asset })

  // storage is local-disk only — read the original in place, no tmp staging copy
  const ctx = { data, record, asset, filePath: storage.pathFor(record.storageKey) }
  if (await spec.beforeBody?.(ctx)) return
  try {
    await spec.body(ctx)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const missingModel = spec.missingModelMarkers.some((marker) => message.includes(marker))
    if (missingModel) {
      logger.warn(`${spec.label} skipped (missing model): asset=${assetId} — ${message}`)
    } else {
      logger.error(`${failureLabel} failed: asset=${assetId} — ${message}`)
    }
    await spec.onFailure?.({ userId, assetId, message, sig: data.sig })
    if (!missingModel) throw err
  }
}

// EXIF-oriented downscale to a max long side — shared prep for face/embedding/detection bodies
export async function orientedResize(filePath: string, maxPx: number): Promise<Buffer> {
  return sharp(filePath)
    .rotate()
    .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
    .toBuffer()
}

// EXIF-oriented prep + geometry for box scaling: EXIF orientations 5-8 transpose the stored
// pixels, so the displayed (oriented) original swaps axes; boxes must be stored in that oriented
// space to match the browser/thumbnails, and `.rotate()` above applies the same swap to the buffer
export async function orientedPrep(
  filePath: string,
  maxPx: number,
): Promise<{ resized: Buffer; scaleX: number; scaleY: number; origW: number; origH: number }> {
  const metadata = await sharp(filePath).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions')
  }
  const swapped = (metadata.orientation ?? 1) >= 5
  const origW = swapped ? metadata.height : metadata.width
  const origH = swapped ? metadata.width : metadata.height
  // resolveWithObject gives the resized dims directly — no second decode just to measure them
  const { data: resized, info } = await sharp(filePath)
    .rotate()
    .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true })
  return { resized, scaleX: origW / info.width, scaleY: origH / info.height, origW, origH }
}

// best-effort failure marker: a failed patch must never mask the original job error
export async function patchStatusFailed(
  core: CoreClient,
  logger: Logger,
  userId: string,
  assetId: string,
  patch: MetadataPatch,
  sig?: string,
): Promise<void> {
  try {
    await core.patchMetadata(userId, assetId, patch, sig === undefined ? undefined : { sig })
  } catch (patchErr) {
    const message = patchErr instanceof Error ? patchErr.message : String(patchErr)
    logger.warn(`Failed to patch status to failed for asset=${assetId}: ${message}`)
  }
}
