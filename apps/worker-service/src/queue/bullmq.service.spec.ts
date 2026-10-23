import { describe, expect, it, vi } from 'vitest'
import { BullMqService } from './bullmq.service'

const USER_ID = '33333333-3333-4333-8333-333333333333'

describe('BullMqService.drainUserJobs', () => {
  it('removes only jobs scoped to the user and tolerates queue failures', async () => {
    // no onModuleInit in unit tests: getQueue is stubbed, so no Redis connection is needed
    const service = new BullMqService()
    const victim = { data: { userId: USER_ID }, remove: vi.fn().mockResolvedValue(undefined) }
    const stranger = { data: { userId: 'other' }, remove: vi.fn() }
    const unscoped = { data: {}, remove: vi.fn() }
    const queues = new Map<string, unknown>([
      ['process-thumbnail', { getJobs: vi.fn().mockResolvedValue([victim, stranger, unscoped]) }],
      ['process-video', { getJobs: vi.fn().mockRejectedValue(new Error('redis down')) }],
    ])
    vi.spyOn(service, 'getQueue').mockImplementation(
      (name: string) =>
        (queues.get(name) ?? { getJobs: vi.fn().mockResolvedValue([]) }) as ReturnType<
          BullMqService['getQueue']
        >,
    )

    const removed = await service.drainUserJobs(USER_ID)
    expect(removed).toBe(1)
    expect(victim.remove).toHaveBeenCalled()
    expect(stranger.remove).not.toHaveBeenCalled()
    expect(unscoped.remove).not.toHaveBeenCalled()
  })
})
