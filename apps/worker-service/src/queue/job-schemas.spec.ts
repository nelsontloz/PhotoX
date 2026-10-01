import { describe, expect, it } from 'vitest'
import { UnrecoverableError } from 'bullmq'
import { randomUUID } from 'crypto'
import {
  assertOwnership,
  cleanupOrphansJobSchema,
  faceJobSchema,
  parseJobData,
  thumbnailJobSchema,
} from './job-schemas'

describe('job payload schemas', () => {
  it('passes a valid producer payload through', () => {
    const payload = {
      assetId: randomUUID(),
      fileId: randomUUID(),
      userId: randomUUID(),
      size: 'sm' as const,
    }
    expect(parseJobData(thumbnailJobSchema, payload, 'process-thumbnail')).toEqual(payload)
  })

  it('rejects a payload with a missing field', () => {
    const payload = { assetId: randomUUID(), fileId: randomUUID(), size: 'sm' }
    expect(() => parseJobData(thumbnailJobSchema, payload, 'process-thumbnail')).toThrow(
      UnrecoverableError,
    )
  })

  it('rejects an unknown thumbnail size', () => {
    const payload = {
      assetId: randomUUID(),
      fileId: randomUUID(),
      userId: randomUUID(),
      size: 'xxl',
    }
    expect(() => parseJobData(thumbnailJobSchema, payload, 'process-thumbnail')).toThrow(
      UnrecoverableError,
    )
  })

  it('rejects an unknown face detector', () => {
    const payload = {
      assetId: randomUUID(),
      fileId: randomUUID(),
      userId: randomUUID(),
      detector: 'bogus',
    }
    expect(() => parseJobData(faceJobSchema, payload, 'process-faces')).toThrow(UnrecoverableError)
  })

  it('accepts cleanup-orphans payloads from both producers', () => {
    expect(parseJobData(cleanupOrphansJobSchema, {}, 'cleanup-orphans')).toEqual({})
    expect(parseJobData(cleanupOrphansJobSchema, { dryRun: true }, 'cleanup-orphans')).toEqual({
      dryRun: true,
    })
    expect(() =>
      parseJobData(cleanupOrphansJobSchema, { dryRun: 'yes' }, 'cleanup-orphans'),
    ).toThrow(UnrecoverableError)
  })
})

describe('assertOwnership', () => {
  const job = { assetId: randomUUID(), fileId: randomUUID(), userId: randomUUID() }

  it('accepts matching DTO-shaped records', () => {
    expect(() =>
      assertOwnership(job, {
        record: { userId: job.userId },
        asset: { userId: job.userId, fileId: job.fileId },
      }),
    ).not.toThrow()
  })

  it('accepts matching entity-shaped records', () => {
    const record = { id: job.fileId, userId: job.userId }
    const asset = { id: job.assetId, userId: job.userId, fileId: job.fileId }
    expect(() => assertOwnership(job, { record, asset })).not.toThrow()
  })

  it('rejects a mismatched user on either record', () => {
    const other = randomUUID()
    expect(() =>
      assertOwnership(job, {
        record: { userId: other },
        asset: { userId: job.userId, fileId: job.fileId },
      }),
    ).toThrow(UnrecoverableError)
    expect(() =>
      assertOwnership(job, {
        record: { userId: job.userId },
        asset: { userId: other, fileId: job.fileId },
      }),
    ).toThrow(UnrecoverableError)
  })

  it('rejects an asset that points at a different file', () => {
    expect(() =>
      assertOwnership(job, {
        record: { userId: job.userId },
        asset: { userId: job.userId, fileId: randomUUID() },
      }),
    ).toThrow(UnrecoverableError)
    expect(() =>
      assertOwnership(job, {
        record: { userId: job.userId },
        asset: { userId: job.userId },
      }),
    ).toThrow(UnrecoverableError)
  })
})
