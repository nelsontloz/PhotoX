import { describe, it, expect, vi, beforeEach } from 'vitest'

const getMock = vi.hoisted(() => vi.fn())

vi.mock('./client', () => ({ api: { get: getMock } }))

import { listAllPersons } from './persons'

describe('listAllPersons', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pages until total is reached', async () => {
    getMock
      .mockResolvedValueOnce({ data: { items: [{ id: 'p1' }], total: 2, limit: 200, offset: 0 } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'p2' }], total: 2, limit: 200, offset: 1 } })
    const items = await listAllPersons()
    expect(items.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(getMock).toHaveBeenNthCalledWith(2, '/v1/persons', { params: { limit: 200, offset: 1 } })
  })

  it('stops when a page comes back empty', async () => {
    getMock.mockResolvedValue({ data: { items: [], total: 3, limit: 200, offset: 0 } })
    await expect(listAllPersons()).resolves.toEqual([])
    expect(getMock).toHaveBeenCalledTimes(1)
  })
})
