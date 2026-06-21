import { type INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import type { Server } from 'node:http'
import { createTestApp, closeTestApp, mintUserId, createAssetForUser } from './helpers'

let app: INestApplication
let httpServer: Server

beforeAll(async () => {
  ;({ app, httpServer } = await createTestApp())
}, 120_000)

afterAll(async () => {
  await closeTestApp(app)
})

describe('Benchmark listByUser', () => {
  it('measures time to fetch 1000 assets', async () => {
    const userId = mintUserId()

    // Seed 1000 assets
    const promises = []
    for (let i = 0; i < 1000; i++) {
      promises.push(createAssetForUser(httpServer, userId, { title: `Asset ${i}` }))
    }
    await Promise.all(promises)

    const start = performance.now()
    const res = await supertest(httpServer)
      .get(`/v1/internal/users/${userId}/assets`)
      .expect(200)
    const end = performance.now()

    console.log(`Time taken to fetch 1000 assets: ${end - start} ms`)
    const body = res.body as { items: unknown[] }
    expect(body.items.length).toBeGreaterThan(0) // Now returns paginated object
  }, 120000)
})
