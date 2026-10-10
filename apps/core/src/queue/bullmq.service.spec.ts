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
    service.enqueueAssetJob(kind, 'a1', 'f1', 'u1')
    await vi.waitFor(() => expect(add).toHaveBeenCalled())
    expect(add).toHaveBeenCalledWith(
      queue,
      { assetId: 'a1', fileId: 'f1', userId: 'u1' },
      expect.objectContaining({ jobId }),
    )
  })
})
