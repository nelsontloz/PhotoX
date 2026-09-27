import { describe, expect, it } from 'vitest'
import { UnrecoverableError } from 'bullmq'
import { randomUUID } from 'crypto'
import { cleanupOrphansJobSchema, parseJobData, thumbnailJobSchema } from './job-schemas'

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
