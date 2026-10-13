import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import sharp from 'sharp'
import type { z } from 'zod'
import type { Asset, FileRecord } from '@photox/shared-types'
import { LocalStorageService } from '@photox/shared-config'
import { assertOwnership, parseJobData } from './job-schemas'
import type { CoreClient, MetadataPatch } from '../core/core-client.service'

export interface AssetFileJobData {
  assetId: string
  fileId: string
  userId: string
  sig?: string
}

export interface AssetFileJobSpec<T extends AssetFileJobData> {
  queue: string
  schema: z.ZodType<T>
  // human label for the start/skip/failure logs, e.g. 'Embedding'
  label: string
  // error substrings that mean "model weights not provisioned" — warn + no retry
  missingModelMarkers: string[]
  body: (ctx: { data: T; record: FileRecord; asset: Asset; filePath: string }) => Promise<void>
  // runs on both the missing-model skip and a real failure — e.g. patch a status to failed
  onFailure?: (ctx: {
    userId: string
    assetId: string
    message: string
    sig?: string
  }) => Promise<void>
}

export async function runAssetFileJob<T extends AssetFileJobData>(
  deps: { core: CoreClient; storage: LocalStorageService; logger: Logger },
  job: Job<T>,
  spec: AssetFileJobSpec<T>,
): Promise<void> {
  const data = parseJobData(spec.schema, job.data, spec.queue)
  const { assetId, fileId, userId } = data
  const { core, storage, logger } = deps

  logger.log(`Processing ${spec.label}: asset=${assetId}`)

  const record = await core.getFile(userId, fileId)
  const asset = await core.getAsset(userId, assetId)
  assertOwnership({ assetId, fileId, userId }, { record, asset })

  // storage is local-disk only — read the original in place, no tmp staging copy
  const filePath = storage.pathFor(record.storageKey)
  try {
    await spec.body({ data, record, asset, filePath })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const missingModel = spec.missingModelMarkers.some((marker) => message.includes(marker))
    if (missingModel) {
      logger.warn(`${spec.label} skipped (missing model): asset=${assetId} — ${message}`)
    } else {
      logger.error(`${spec.label} failed: asset=${assetId} — ${message}`)
    }
    await spec.onFailure?.({ userId, assetId, message, sig: data.sig })
    if (!missingModel) throw err
  }
}

// EXIF-oriented downscale to a max long side — shared prep for face/embedding/detection/OCR bodies
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
  const resized = await orientedResize(filePath, maxPx)
  const resizedMeta = await sharp(resized).metadata()
  const resizedW = resizedMeta.width ?? origW
  const resizedH = resizedMeta.height ?? origH
  return { resized, scaleX: origW / resizedW, scaleY: origH / resizedH, origW, origH }
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
