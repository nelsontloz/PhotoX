import { createHmac } from 'node:crypto'
import request from 'supertest'
import { BullMqService } from '../../src/queue/bullmq.service'
import { TEST_WORKER_SECRET } from './test-setup'
import {
  apiServer,
  closeTestApp,
  createApiTestApp,
  resetDb,
  seedAsset,
  seedFile,
  seedUser,
} from './helpers'
import type { ApiTestApp } from './helpers'

// HMAC of sub:scope under the worker secret, mirroring BullMqService.withJobSig;
// the guard accepts when it verifies against ANY request scope (route target,
// body asset, X-Job-Scope header, or sub)
function jobSig(sub: string, scope: string): string {
  return createHmac('sha256', TEST_WORKER_SECRET).update(`${sub}:${scope}`).digest('hex')
}

describe('worker job binding (H1)', () => {
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

  it('forged act token reads victim asset without job binding', async () => {
    const victim = await seedUser(t)
    const file = await seedFile(t, victim.id)
    const asset = await seedAsset(t, victim.id, file.id)
    const forged = t.signWorkerToken(
      { id: victim.id, email: victim.email, role: victim.role },
      { act: true },
    )
    // H1: Redis-forged act token reads as victim — expect 403 after fix, currently 200
    const res = await request(apiServer(t))
      .get(`/worker/assets/${asset.id}`)
      .set(t.authHeader(forged))
    expect(res.status).toBe(403)
  })

  it('sig-less worker write is already denied', async () => {
    const victim = await seedUser(t)
    const file = await seedFile(t, victim.id)
    const asset = await seedAsset(t, victim.id, file.id)
    const forged = t.signWorkerToken(
      { id: victim.id, email: victim.email, role: victim.role },
      { act: true },
    )
    const res = await request(apiServer(t))
      .delete(`/worker/assets/${asset.id}/faces`)
      .set(t.authHeader(forged))
    expect(res.status).toBe(403)
  })

  it('sig-less GET /worker/files/:id is denied', async () => {
    const victim = await seedUser(t)
    const file = await seedFile(t, victim.id)
    const forged = t.signWorkerToken(
      { id: victim.id, email: victim.email, role: victim.role },
      { act: true },
    )
    const res = await request(apiServer(t))
      .get(`/worker/files/${file.id}`)
      .set(t.authHeader(forged))
    expect(res.status).toBe(403)
  })

  it('GET /worker/assets/:id with valid job binding succeeds', async () => {
    const victim = await seedUser(t)
    const file = await seedFile(t, victim.id)
    const asset = await seedAsset(t, victim.id, file.id)
    const token = t.signWorkerToken(
      { id: victim.id, email: victim.email, role: victim.role },
      { act: true },
    )
    const res = await request(apiServer(t))
      .get(`/worker/assets/${asset.id}`)
      .set(t.authHeader(token))
      .set('X-Job-Signature', jobSig(victim.id, asset.id))
      .set('X-Job-Scope', asset.id)
    expect(res.status).toBe(200)
  })

  it('GET /worker/assets/:id with wrong-scope binding is denied', async () => {
    const victim = await seedUser(t)
    const file = await seedFile(t, victim.id)
    const asset = await seedAsset(t, victim.id, file.id)
    const token = t.signWorkerToken(
      { id: victim.id, email: victim.email, role: victim.role },
      { act: true },
    )
    // the presented sig must cover a scope from this request (route target, claimed
    // scope, or sub) — a sig minted for an unrelated scope is denied even when the
    // claimed scope header names the route target, as a legit worker would send it
    const res = await request(apiServer(t))
      .get(`/worker/assets/${asset.id}`)
      .set(t.authHeader(token))
      .set('X-Job-Signature', jobSig(victim.id, 'wrong-scope'))
      .set('X-Job-Scope', asset.id)
    expect(res.status).toBe(403)
  })

  it('GET /worker/files/:id with assetId-scoped job binding succeeds', async () => {
    const victim = await seedUser(t)
    const file = await seedFile(t, victim.id)
    const asset = await seedAsset(t, victim.id, file.id)
    const token = t.signWorkerToken(
      { id: victim.id, email: victim.email, role: victim.role },
      { act: true },
    )
    // the enqueue stamps scope from the job payload (first of assetId|fileId|userId —
    // the assetId here) while the file route addresses the fileId; the guard accepts
    // the sig via the worker's claimed scope, and the service still scopes by sub
    const res = await request(apiServer(t))
      .get(`/worker/files/${file.id}`)
      .set(t.authHeader(token))
      .set('X-Job-Signature', jobSig(victim.id, asset.id))
      .set('X-Job-Scope', asset.id)
    expect(res.status).toBe(200)
  })
})
