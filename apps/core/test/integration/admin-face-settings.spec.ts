import request from 'supertest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FACE_DETECTOR_KINDS,
  type FaceDetectionSettings,
  type FaceDetectorKind,
} from '@photox/shared-types'
import { closeTestApp, createApiTestApp, resetDb, seedUser, apiServer } from './helpers'
import type { ApiTestApp } from './helpers'

function envDefault(): FaceDetectorKind {
  return process.env.FACE_DETECTOR === 'scrfd' ? 'scrfd' : 'human'
}

describe('admin face detection settings', () => {
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

  async function adminAuth(): Promise<Record<string, string>> {
    const admin = await seedUser(t, { role: 'admin' })
    return t.authHeader(t.signToken({ id: admin.id, email: admin.email, role: admin.role }))
  }

  it('rejects unauthenticated requests', async () => {
    const get = await request(apiServer(t)).get('/api/v1/admin/face-detection')
    expect(get.status).toBe(401)
    const put = await request(apiServer(t))
      .put('/api/v1/admin/face-detection')
      .send({ detector: 'scrfd' })
    expect(put.status).toBe(401)
  })

  it('rejects non-admin requests', async () => {
    const user = await seedUser(t)
    const auth = t.authHeader(t.signToken({ id: user.id, email: user.email, role: user.role }))
    const get = await request(apiServer(t)).get('/api/v1/admin/face-detection').set(auth)
    expect(get.status).toBe(403)
    const put = await request(apiServer(t))
      .put('/api/v1/admin/face-detection')
      .set(auth)
      .send({ detector: 'scrfd' })
    expect(put.status).toBe(403)
  })

  it('returns detector, env default and scrfd availability for admin', async () => {
    const auth = await adminAuth()
    const res = await request(apiServer(t)).get('/api/v1/admin/face-detection').set(auth)
    expect(res.status).toBe(200)
    const body = res.body as FaceDetectionSettings
    expect(FACE_DETECTOR_KINDS).toContain(body.detector)
    expect(body.detector).toBe(envDefault())
    expect(body.envDefault).toBe(envDefault())
    expect(body.models).toEqual({ scrfd: false })
  })

  it('persists the detector and reflects it in a following GET', async () => {
    const auth = await adminAuth()
    const put = await request(apiServer(t))
      .put('/api/v1/admin/face-detection')
      .set(auth)
      .send({ detector: 'scrfd' })
    expect(put.status).toBe(200)
    expect((put.body as FaceDetectionSettings).detector).toBe('scrfd')

    const get = await request(apiServer(t)).get('/api/v1/admin/face-detection').set(auth)
    expect(get.status).toBe(200)
    const body = get.body as FaceDetectionSettings
    expect(body.detector).toBe('scrfd')
    expect(body.envDefault).toBe(envDefault())

    const back = await request(apiServer(t))
      .put('/api/v1/admin/face-detection')
      .set(auth)
      .send({ detector: 'human' })
    expect(back.status).toBe(200)
    expect((back.body as FaceDetectionSettings).detector).toBe('human')
  })

  it('rejects an invalid detector with 400', async () => {
    const auth = await adminAuth()
    const invalid = await request(apiServer(t))
      .put('/api/v1/admin/face-detection')
      .set(auth)
      .send({ detector: 'bogus' })
    expect(invalid.status).toBe(400)

    const missing = await request(apiServer(t))
      .put('/api/v1/admin/face-detection')
      .set(auth)
      .send({})
    expect(missing.status).toBe(400)

    const get = await request(apiServer(t)).get('/api/v1/admin/face-detection').set(auth)
    expect((get.body as FaceDetectionSettings).detector).toBe(envDefault())
  })

  it('reports scrfd model availability from STORAGE_DIR/models', async () => {
    const auth = await adminAuth()
    await mkdir(join(t.storageDir, 'models'), { recursive: true })
    await writeFile(join(t.storageDir, 'models', 'det_10g.onnx'), Buffer.from('model'))
    const res = await request(apiServer(t)).get('/api/v1/admin/face-detection').set(auth)
    expect(res.status).toBe(200)
    expect((res.body as FaceDetectionSettings).models).toEqual({ scrfd: true })
  })
})
