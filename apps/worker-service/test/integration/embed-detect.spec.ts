import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import {
  closeTestApp,
  createTestApp,
  resetTestApp,
  seedOriginal,
  signJob,
  waitForJob,
  type TestApp,
} from './helpers'

// processor wiring smokes for the two newest queues — the model weights are absent in the
// harness storage dir, so each job must take the warn-skip path (missing model is provisioning,
// not a job bug): completed, no register call, no retry
describe('Embedding/Detection processors (integration)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await createTestApp()
  }, 120_000)

  afterAll(async () => {
    await closeTestApp(testApp)
  })

  beforeEach(() => resetTestApp(testApp))

  async function seedPhoto(userId: string) {
    const bytes = await sharp({
      create: { width: 200, height: 150, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer()
    return seedOriginal(testApp, { userId, bytes, mimeType: 'image/jpeg', ext: 'jpg' })
  }

  it('warn-skips an embedding job when the vision model is absent', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedPhoto(userId)

    const queue = testApp.getQueue('process-embeddings')
    const job = await queue.add(
      'embedding',
      signJob({ assetId: asset.id, fileId: record.id, userId }),
    )

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(testApp.fake.callsOf('registerEmbedding')).toHaveLength(0)
    expect(testApp.fake.callsOf('patchMetadata').at(-1)!.args[1]).toEqual({
      embeddingStatus: 'failed',
    })
  })

  it('warn-skips a detection job when the detection model is absent', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedPhoto(userId)

    const queue = testApp.getQueue('process-detect')
    const job = await queue.add('detect', signJob({ assetId: asset.id, fileId: record.id, userId }))

    expect(await waitForJob(queue, job.id!)).toBe('completed')
    expect(testApp.fake.callsOf('registerDetections')).toHaveLength(0)
  })
})
