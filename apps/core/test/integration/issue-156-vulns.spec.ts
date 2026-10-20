import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { SEARCH_EMBEDDING_DIM, SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { ACCESS_COOKIE } from '../../src/auth/auth-cookie'
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

// issue #156: each test expects SECURE behavior and currently FAILS (insecure behavior),
// except the three noted passing guards that lock already-correct boundaries.
describe('issue-156 vulns (expect secure, currently insecure)', () => {
  let t: ApiTestApp

  beforeAll(async () => {
    t = await createApiTestApp({ mockUser: null })
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(t)
  })

  beforeEach(async () => {
    await resetDb(t)
  })

  interface TokUser {
    id: string
    email: string
    role: 'user' | 'admin'
  }
  const userTok = (u: TokUser) => t.signToken({ id: u.id, email: u.email, role: u.role })
  // phase-2 secret split: worker-origin tokens are minted under WORKER_JWT_SECRET — core's
  // guard verifies them against the worker secret and still gates them via the act allowlist
  const forgedAs = (u: { id: string; email: string }) =>
    t.signWorkerToken({ id: u.id, email: u.email, role: 'user' }, { act: true })
  const workerAdmin = () =>
    t.signWorkerToken(
      { id: 'worker-service', email: 'worker@internal', role: 'admin' },
      { act: true },
    )

  async function shareToken(owner: TokUser, assetId: string): Promise<string> {
    const res = await request(apiServer(t))
      .post('/api/v1/shares')
      .set(t.authHeader(userTok(owner)))
      .send({ assetId })
    expect(res.status).toBe(201)
    return (res.body as unknown as { token: string }).token
  }

  it('stream BOLA: cross-user stream returns 404 like download/getOne', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const file = await seedFile(t, a.id, { bytes: Buffer.from('victim-bytes') })
    await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/stream`)
      .set(t.authHeader(userTok(b)))
    expect(res.status).toBe(404)
  })

  it('transcodeFileId overwrite: the user metadata route is gone', async () => {
    const victim = await seedUser(t)
    const attacker = await seedUser(t)
    const victimFile = await seedFile(t, victim.id)
    const attackerFile = await seedFile(t, attacker.id)
    const attackerAsset = await seedAsset(t, attacker.id, attackerFile.id)
    // transcodeFileId is worker-only now; the user route that accepted it was removed
    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${attackerAsset.id}/metadata`)
      .set(t.authHeader(userTok(attacker)))
      .send({ transcodeFileId: victimFile.id })
    expect(res.status).toBe(404)
  })

  it('vuln1 victim read: forged act token cannot GET victim asset', async () => {
    const a = await seedUser(t)
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    const res = await request(apiServer(t))
      .get(`/api/v1/assets/${asset.id}`)
      .set(t.authHeader(forgedAs(a)))
    expect(res.status).toBe(403)
  })

  it('vuln1 victim write: the user metadata route is gone, so a forged act token has no write path', async () => {
    const a = await seedUser(t)
    const file = await seedFile(t, a.id)
    const asset = await seedAsset(t, a.id, file.id)
    // the user metadata route only existed for the worker contract and is gone now
    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(forgedAs(a)))
      .send({ width: 999 })
    expect(res.status).toBe(404)
  })

  it('vuln1 orphan run: worker admin token cannot run orphan cleanup', async () => {
    const res = await request(apiServer(t))
      .post('/api/v1/admin/cleanup-orphans/run')
      .set(t.authHeader(workerAdmin()))
    expect(res.status).toBe(403)
  })

  it('vuln1 no escalation: the admin file-delete route no longer exists (passing guard)', async () => {
    const victim = await seedUser(t)
    const file = await seedFile(t, victim.id)
    const res = await request(apiServer(t))
      .delete(`/api/v1/admin/files/${file.id}`)
      .set(t.authHeader(forgedAs(victim)))
    // the route was deleted, so the guard never sees it and the request 404s
    expect(res.status).toBe(404)
  })

  it('vuln2 enumeration: worker admin ids filter leaks no victim rows', async () => {
    const victim = await seedUser(t)
    const file = await seedFile(t, victim.id)
    const asset = await seedAsset(t, victim.id, file.id)
    // userId-scoped list currently holds for the worker sub — passing guard, locks the boundary
    const res = await request(apiServer(t))
      .get('/api/v1/assets')
      .query({ ids: asset.id })
      .set(t.authHeader(workerAdmin()))
    expect(res.status).toBe(200)
    expect((res.body as unknown as { items: { id: string }[] }).items).toHaveLength(0)
  })

  it('vuln2 unknown-id oracle: admin file-delete is gone, so a worker token cannot probe it', async () => {
    const res = await request(apiServer(t))
      .delete(`/api/v1/admin/files/${randomUUID()}`)
      .set(t.authHeader(workerAdmin()))
    // the route was deleted, so the guard never sees it and the request 404s
    expect(res.status).toBe(404)
  })

  it('vuln3 share→stream chain: public JSON exposes no ids to chain from (hash-era)', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const file = await seedFile(t, a.id, { bytes: Buffer.from('victim-bytes-123') })
    const asset = await seedAsset(t, a.id, file.id)
    const token = await shareToken(a, asset.id)
    const pub = await request(apiServer(t)).get(`/api/share/${token}`)
    expect(pub.status).toBe(200)
    const body = pub.body as unknown as {
      share: Record<string, unknown>
      asset: Record<string, unknown>
    }
    // hash-era contract (mirrors #12c): no ids to chain into the files API
    for (const key of ['fileId', 'transcodeFileId', 'userId']) {
      expect(body.asset).not.toHaveProperty(key)
      expect(body.share).not.toHaveProperty(key)
    }
    // BOLA with no exposed id at all: B streams/downloads the victim file directly → 404
    const stream = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/stream`)
      .set(t.authHeader(userTok(b)))
    expect(stream.status).toBe(404)
    const download = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/download`)
      .set(t.authHeader(userTok(b)))
    expect(download.status).toBe(404)
  })

  it('vuln3 download parity: B download of victim file is 404 (passing guard)', async () => {
    const a = await seedUser(t)
    const b = await seedUser(t)
    const file = await seedFile(t, a.id)
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/download`)
      .set(t.authHeader(userTok(b)))
    expect(res.status).toBe(404)
  })

  it('vuln3 cookie stream: B cookie cannot stream victim file', async () => {
    const a = await seedUser(t)
    const file = await seedFile(t, a.id, { bytes: Buffer.from('victim-bytes-456') })
    const reg = await request(apiServer(t))
      .post('/api/v1/auth/register')
      .send({ email: 'cookie-b@example.com', password: 'correcthorsebattery', displayName: 'B' })
    expect(reg.status).toBe(201)
    const jar =
      ((reg.headers['set-cookie'] as unknown as string[]) ?? [])
        .find((c) => c.startsWith(`${ACCESS_COOKIE}=`))
        ?.split(';')[0] ?? ''
    const res = await request(apiServer(t))
      .get(`/api/v1/files/${file.id}/stream`)
      .set('Cookie', jar)
    expect(res.status).toBe(404)
  })

  it('vuln4 exactly-one: concurrent registers yield no admins', async () => {
    const register = (email: string) =>
      request(apiServer(t))
        .post('/api/v1/auth/register')
        .send({ email, password: 'correcthorsebattery', displayName: 'Race' })
    const [r1, r2] = await Promise.all([register('e1@example.com'), register('e2@example.com')])
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    // open registration never mints admin, so the check-then-insert race is vacuous: 0 admins
    const admins = (await t.userRepo.find()).filter((u) => u.role === 'admin')
    expect(admins).toHaveLength(0)
  })

  it('vuln5 phash: the user metadata route is gone, so phash is unreachable', async () => {
    const u = await seedUser(t)
    const file = await seedFile(t, u.id)
    const asset = await seedAsset(t, u.id, file.id)
    // extraction fields (phash/status/GPS) are worker-only now; the user route was removed
    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(userTok(u)))
      .send({ phash: 'deadbeefdeadbeef' })
    expect(res.status).toBe(404)
  })

  it('vuln5 fake status/GPS: the user metadata route is gone', async () => {
    const u = await seedUser(t)
    const file = await seedFile(t, u.id)
    const asset = await seedAsset(t, u.id, file.id)
    const res = await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(userTok(u)))
      .send({ transcodeStatus: 'ready', latitude: 1, longitude: 2 })
    expect(res.status).toBe(404)
  })

  it('vuln5 index poison: user token cannot register embedding on own asset', async () => {
    const u = await seedUser(t)
    const file = await seedFile(t, u.id)
    const asset = await seedAsset(t, u.id, file.id)
    // unit-norm vector passes the trust-boundary assertValid, isolating the auth gap; the user
    // register route moved behind the act-required worker namespace, so a plain token 403s
    const v = 1 / Math.sqrt(SEARCH_EMBEDDING_DIM)
    const embedding = Array(SEARCH_EMBEDDING_DIM).fill(v)
    const res = await request(apiServer(t))
      .post(`/worker/assets/${asset.id}/embedding`)
      .set(t.authHeader(userTok(u)))
      .send({ kind: 'image', model: SEARCH_EMBEDDING_MODEL, embedding })
    expect(res.status).toBe(403)
  })

  it('vuln5 unbounded thumbs: the user thumbnail route is gone', async () => {
    const victim = await seedUser(t)
    const attacker = await seedUser(t)
    const victimFile = await seedFile(t, victim.id)
    const attackerFile = await seedFile(t, attacker.id)
    const asset = await seedAsset(t, attacker.id, attackerFile.id)
    for (const size of ['evil-1', 'evil-2', 'evil-3']) {
      const res = await request(apiServer(t))
        .post(`/api/v1/assets/${asset.id}/thumbnails`)
        .set(t.authHeader(userTok(attacker)))
        .send({ size, fileId: victimFile.id, width: 320, height: 240, bytes: 1024 })
      expect(res.status).toBe(404)
    }
  })

  it('vuln5 transcode serve: share serves attacker bytes, not victim bytes', async () => {
    const victimBytes = Buffer.from('victim-video-bytes-0123456789')
    const attackerBytes = Buffer.from('att-vid')
    const victim = await seedUser(t)
    const attacker = await seedUser(t)
    const victimFile = await seedFile(t, victim.id, { bytes: victimBytes })
    const attackerFile = await seedFile(t, attacker.id, { bytes: attackerBytes })
    const asset = await seedAsset(t, attacker.id, attackerFile.id)
    await request(apiServer(t))
      .patch(`/api/v1/assets/${asset.id}/metadata`)
      .set(t.authHeader(userTok(attacker)))
      .send({ transcodeFileId: victimFile.id })
    const token = await shareToken(attacker, asset.id)
    const res = await request(apiServer(t)).get(`/api/share/${token}/stream`)
    expect(res.status).toBe(200)
    // distinct lengths tell whose bytes are served without binary-body parsing
    expect(Number(res.headers['content-length'])).toBe(attackerBytes.length)
  })
})
