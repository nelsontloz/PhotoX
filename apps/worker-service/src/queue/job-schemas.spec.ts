import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { UnrecoverableError } from 'bullmq'
import { createHmac, randomUUID } from 'crypto'
import {
  assertOwnership,
  bindingOf,
  clusterJobSchema,
  faceJobSchema,
  parseJobData,
  thumbnailJobSchema,
} from './job-schemas'
import { signJob, useTestAuthEnv } from '../../test/sign-job'

describe('job payload schemas', () => {
  beforeEach(useTestAuthEnv)

  it('passes a valid producer payload through', () => {
    const payload = {
      assetId: randomUUID(),
      fileId: randomUUID(),
      userId: randomUUID(),
      size: 'sm' as const,
    }
    const signed = signJob(payload)
    expect(parseJobData(thumbnailJobSchema, signed, 'process-thumbnail')).toEqual(signed)
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

  it('accepts a face payload carrying the three refs and strips a legacy detector field', () => {
    const payload = {
      assetId: randomUUID(),
      fileId: randomUUID(),
      userId: randomUUID(),
    }
    const signed = signJob(payload)
    expect(parseJobData(faceJobSchema, signed, 'process-faces')).toEqual(signed)
    // redis may still hold pre-SCRFD-only jobs that carried `detector` — zod strips the unknown key
    expect(parseJobData(faceJobSchema, { ...signed, detector: 'legacy' }, 'process-faces')).toEqual(
      signed,
    )
  })

  it('rejects metadataWaits above the processor wait budget', () => {
    const base = {
      assetId: randomUUID(),
      fileId: randomUUID(),
      userId: randomUUID(),
      size: 'sm' as const,
    }
    // 5 is the budget ceiling (MAX_METADATA_WAITS in thumbnail.processor.ts); 6-10 used to
    // parse fine and then silently skip the defer they asked for
    expect(
      parseJobData(thumbnailJobSchema, signJob({ ...base, metadataWaits: 5 }), 'process-thumbnail'),
    ).toMatchObject({ metadataWaits: 5 })
    for (const metadataWaits of [6, 7, 8, 9, 10]) {
      expect(() =>
        parseJobData(thumbnailJobSchema, signJob({ ...base, metadataWaits }), 'process-thumbnail'),
      ).toThrow(UnrecoverableError)
    }
  })
})

describe('job signature verification', () => {
  const AUTH_SECRET = '0123456789abcdef0123456789abcdef'
  const WORKER_SECRET = 'worker-test-secret-9f8e7d6c5b4a3210'
  let savedAuth: string | undefined
  let savedWorker: string | undefined

  const sign = (sub: string, scope: string) =>
    createHmac('sha256', WORKER_SECRET).update(`${sub}:${scope}`).digest('hex')

  beforeEach(() => {
    savedAuth = process.env.AUTH_TOKEN_SECRET
    savedWorker = process.env.WORKER_JWT_SECRET
    process.env.AUTH_TOKEN_SECRET = AUTH_SECRET
    process.env.WORKER_JWT_SECRET = WORKER_SECRET
  })

  afterEach(() => {
    if (savedAuth === undefined) delete process.env.AUTH_TOKEN_SECRET
    else process.env.AUTH_TOKEN_SECRET = savedAuth
    if (savedWorker === undefined) delete process.env.WORKER_JWT_SECRET
    else process.env.WORKER_JWT_SECRET = savedWorker
  })

  it('accepts a core-stamped payload and binds the asset-first scope', () => {
    const payload = {
      assetId: randomUUID(),
      fileId: randomUUID(),
      userId: randomUUID(),
      size: 'sm' as const,
    }
    const signed = { ...payload, sig: sign(payload.userId, payload.assetId) }
    expect(parseJobData(thumbnailJobSchema, signed, 'process-thumbnail')).toEqual(signed)
    expect(bindingOf(signed)).toEqual({ sig: signed.sig, scope: payload.assetId })
  })

  it('rejects a missing sig without retrying', () => {
    const payload = {
      assetId: randomUUID(),
      fileId: randomUUID(),
      userId: randomUUID(),
      size: 'sm' as const,
    }
    expect(() => parseJobData(thumbnailJobSchema, payload, 'process-thumbnail')).toThrow(
      UnrecoverableError,
    )
    expect(bindingOf(payload)).toBeUndefined()
  })

  it('rejects a sig bound to the wrong scope', () => {
    const payload = {
      assetId: randomUUID(),
      fileId: randomUUID(),
      userId: randomUUID(),
      size: 'sm' as const,
    }
    // valid HMAC but over the file scope — derivation demands the asset-first scope
    const signed = { ...payload, sig: sign(payload.userId, payload.fileId) }
    expect(() => parseJobData(thumbnailJobSchema, signed, 'process-thumbnail')).toThrow(
      UnrecoverableError,
    )
  })

  it('verifies user-scoped cluster jobs against the sub itself', () => {
    const userId = randomUUID()
    const signed = { userId, sig: sign(userId, userId) }
    expect(parseJobData(clusterJobSchema, signed, 'process-faces-cluster')).toEqual(signed)
    expect(bindingOf(signed)).toEqual({ sig: signed.sig, scope: userId })
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
