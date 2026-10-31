import { describe, expect, it, vi } from 'vitest'
import { ProcessorsService } from './processors.service'

const QUEUES = [
  'process-thumbnail',
  'process-video',
  'process-metadata',
  'process-faces',
  'process-faces-cluster',
  'process-embeddings',
  'process-detect',
  'user-delete',
]

describe('ProcessorsService', () => {
  function setup(createWorker = vi.fn()) {
    const bullMq = { ready: vi.fn().mockResolvedValue(undefined), createWorker }
    const service = new ProcessorsService(
      bullMq as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    return { service, bullMq }
  }

  it('waits for the Redis connection, then registers every queue once', async () => {
    const order: string[] = []
    const createWorker = vi.fn((name: string) => {
      order.push(`worker:${name}`)
      return {}
    })
    const { service, bullMq } = setup(createWorker)
    bullMq.ready.mockImplementation(() => {
      order.push('ready')
      return Promise.resolve()
    })

    await service.onModuleInit()

    expect(order[0]).toBe('ready')
    expect(order.slice(1)).toEqual(QUEUES.map((name) => `worker:${name}`))
    expect(createWorker).toHaveBeenCalledTimes(QUEUES.length)
  })

  it('starts the other queues when one createWorker throws', async () => {
    const started: string[] = []
    const createWorker = vi.fn((name: string) => {
      started.push(name)
      if (name === 'process-video') throw new Error('boom')
      return {}
    })
    const { service } = setup(createWorker)

    await expect(service.onModuleInit()).resolves.toBeUndefined()

    expect(started).toEqual(QUEUES)
  })
})
