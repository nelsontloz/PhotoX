import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, assetPayload } from './helpers'

interface ErrorBody {
  message: string
}

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('UserIdGuard — x-user-id header', () => {
  it('UC-U16: POST /v1/assets returns 400 when x-user-id is missing', async () => {
    const res = await supertest(httpServer).post('/v1/assets').send(assetPayload()).expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBe('x-user-id header is required')
  })

  it('UC-U16: GET /v1/assets returns 400 when x-user-id is missing', async () => {
    const res = await supertest(httpServer).get('/v1/assets').expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBe('x-user-id header is required')
  })

  it('UC-U16: GET /v1/assets/:id returns 400 when x-user-id is missing', async () => {
    const res = await supertest(httpServer)
      .get('/v1/assets/00000000-0000-0000-0000-000000000000')
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBe('x-user-id header is required')
  })

  it('UC-U16: PATCH /v1/assets/:id returns 400 when x-user-id is missing', async () => {
    const res = await supertest(httpServer)
      .patch('/v1/assets/00000000-0000-0000-0000-000000000000')
      .send({ title: 'x' })
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBe('x-user-id header is required')
  })

  it('UC-U16: POST /v1/assets/:id/trash returns 400 when x-user-id is missing', async () => {
    const res = await supertest(httpServer)
      .post('/v1/assets/00000000-0000-0000-0000-000000000000/trash')
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBe('x-user-id header is required')
  })

  it('UC-U16: POST /v1/assets/:id/restore returns 400 when x-user-id is missing', async () => {
    const res = await supertest(httpServer)
      .post('/v1/assets/00000000-0000-0000-0000-000000000000/restore')
      .expect(400)

    const body = res.body as ErrorBody
    expect(body.message).toBe('x-user-id header is required')
  })
})
