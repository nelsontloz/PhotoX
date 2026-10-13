import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { BullMqService } from './bullmq.service'

// ponytail: the jobId prefixes are the dedup contract of enqueueAssetJob — pin them
describe('BullMqService.enqueueAssetJob', () => {
  function makeService() {
    const service = new BullMqService()
    const add = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(service, 'getQueue').mockReturnValue({ add } as never)
    return { service, add }
  }

  it.each([
    ['embed', 'process-embeddings', `embed-a1-${SEARCH_EMBEDDING_MODEL}`],
    ['ocr', 'process-ocr', 'ocr-a1'],
    ['detect', 'process-detect', 'detect-a1'],
  ] as const)('%s enqueues %s with the prefix jobId', async (kind, queue, jobId) => {
    const { service, add } = makeService()
    await service.enqueueAssetJob(kind, 'a1', 'f1', 'u1')
    await vi.waitFor(() => expect(add).toHaveBeenCalled())
    expect(add).toHaveBeenCalledWith(
      queue,
      { assetId: 'a1', fileId: 'f1', userId: 'u1' },
      expect.objectContaining({ jobId }),
    )
  })
})

// ponytail: a video retry can cost up to 1h of SVT-AV1 — pin attempts:2 so only one
// expensive retry runs; every other queue keeps the shared default of 3
describe('BullMqService.enqueueVideo', () => {
  function makeService() {
    const service = new BullMqService()
    const add = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(service, 'getQueue').mockReturnValue({ add } as never)
    return { service, add }
  }

  it('enqueues with attempts:2', async () => {
    const { service, add } = makeService()
    await service.enqueueVideo('a1', 'f1', 'u1')
    await vi.waitFor(() => expect(add).toHaveBeenCalled())
    expect(add).toHaveBeenCalledWith(
      'process-video',
      { assetId: 'a1', fileId: 'f1', userId: 'u1' },
      expect.objectContaining({ jobId: 'video-a1', attempts: 2 }),
    )
  })
})
