import request from 'supertest'
import sharp from 'sharp'
import { vi } from 'vitest'
import { BullMqService } from '../../src/queue/bullmq.service'
import { DatabaseModule } from '../../src/database/database.module'
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedUser,
} from './helpers'
import type { ApiTestApp } from './helpers'

async function pngBytes(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: 'red' } })
    .png()
    .toBuffer()
}

function findSynchronize(node: unknown, seen = new Set<unknown>()): unknown {
  if (node === null || typeof node !== 'object' || seen.has(node)) return undefined
  seen.add(node)
  const rec = node as Record<string, unknown>
  if ('synchronize' in rec) return rec.synchronize
  for (const v of Object.values(rec)) {
    const r = findSynchronize(v, seen)
    if (r !== undefined) return r
  }
  return undefined
}

describe('p0 fails-first', () => {
  let t: ApiTestApp

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null })
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(t)
  })

  beforeEach(async () => {
    await resetDb(t)
    await t.app.get(BullMqService).redis.flushdb()
  })

  it('P0-3 Redis-down upload surfaces failure', async () => {
    // fails today (201): enqueue() catch-logs and upload still returns 201-pending
    // with the jobs silently lost — Redis-down must surface, never silent 201
    const user = await seedUser(t)
    const token = t.signToken({ id: user.id, email: user.email, role: user.role })
    const bullMq = t.app.get(BullMqService)
    const spy = vi
      .spyOn(bullMq, 'getQueue')
      .mockReturnValue({ add: vi.fn().mockRejectedValue(new Error('redis down')) } as never)
    try {
      const res = await request(apiServer(t))
        .post('/api/v1/files')
        .set(t.authHeader(token))
        .attach('file', await pngBytes(), 'photo.png')
        .field('kind', 'photo')
      expect([503, 500]).toContain(res.status)
    } finally {
      spy.mockRestore()
    }
  })

  it('P0-2 prod synchronize gate', () => {
    // fails today (always true): synchronize must be false in production, true elsewhere
    const prev = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      const prod = DatabaseModule.forRoot() as unknown as object
      expect(findSynchronize(prod)).toBe(false)
      process.env.NODE_ENV = 'test'
      const dev = DatabaseModule.forRoot() as unknown as object
      expect(findSynchronize(dev)).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
    }
  })
})
