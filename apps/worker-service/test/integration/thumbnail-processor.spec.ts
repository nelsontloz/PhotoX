import sharp from 'sharp'
import { createTestApp, closeTestApp, waitForJob, type TestApp } from './helpers'

describe('ThumbnailProcessor (integration)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await createTestApp()
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(testApp)
  })

  beforeEach(() => {
    testApp.stub.clearRoutes()
    testApp.stub.resetCalls()
  })

  describe('happy path (image)', () => {
    it('generates thumbnail and registers it', async () => {
      const imageBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer()

      testApp.stub.setResponse('GET', '/v1/files/test-file-id/stream', (_call, res) => {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': String(imageBuffer.length),
        })
        res.end(imageBuffer)
      })

      testApp.stub.setResponse('POST', '/v1/files', (_call, res) => {
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'new-file-id' }))
      })

      testApp.stub.setResponse('POST', '/v1/assets/test-asset-id/thumbnails', (_call, res) => {
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            size: 'sm',
            fileId: 'new-file-id',
            width: 100,
            height: 100,
            bytes: 1234,
          }),
        )
      })

      testApp.stub.setResponse('PATCH', '/v1/assets/test-asset-id/metadata', (_call, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({}))
      })

      const queue = testApp.getQueue('process-thumbnail')
      const job = await queue.add('thumbnail', {
        assetId: 'test-asset-id',
        fileId: 'test-file-id',
        size: 'sm',
        userId: 'test-user-id',
      })

      const state = await waitForJob(queue, job.id!)
      expect(state).toBe('completed')

      const calls = testApp.stub.calls
      expect(calls).toHaveLength(4)

      expect(calls[0]).toMatchObject({ method: 'GET', url: '/v1/files/test-file-id/stream' })
      expect(calls[1]).toMatchObject({ method: 'POST', url: '/v1/files' })
      expect(calls[2]).toMatchObject({
        method: 'POST',
        url: '/v1/assets/test-asset-id/thumbnails',
      })
      expect(calls[3]).toMatchObject({
        method: 'PATCH',
        url: '/v1/assets/test-asset-id/metadata',
      })

      const patchBody = JSON.parse(calls[3]!.body.toString()) as { thumbnailStatus: string }
      expect(patchBody).toEqual({ thumbnailStatus: 'ready' })
    })
  })

  describe('error path', () => {
    it('marks thumbnail as failed when upload fails', async () => {
      const imageBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer()

      testApp.stub.setResponse('GET', '/v1/files/test-file-id/stream', (_call, res) => {
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(imageBuffer)
      })

      testApp.stub.setResponse('POST', '/v1/files', (_call, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: 'Internal Server Error' }))
      })

      testApp.stub.setResponse('PATCH', '/v1/assets/test-asset-id/metadata', (_call, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({}))
      })

      const queue = testApp.getQueue('process-thumbnail')
      const job = await queue.add('thumbnail', {
        assetId: 'test-asset-id',
        fileId: 'test-file-id',
        size: 'sm',
        userId: 'test-user-id',
      })

      const state = await waitForJob(queue, job.id!)
      expect(state).toBe('failed')

      const patchCalls = testApp.stub.calls.filter(
        (c) => c.method === 'PATCH' && c.url === '/v1/assets/test-asset-id/metadata',
      )
      expect(patchCalls.length).toBeGreaterThanOrEqual(1)

      const patchBody = JSON.parse(patchCalls[0]!.body.toString()) as { thumbnailStatus: string }
      expect(patchBody).toEqual({ thumbnailStatus: 'failed' })
    })
  })
})
