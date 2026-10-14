import { GroupsService } from './groups.service'

function makeService(queryResult: { id: string }[] = []) {
  let capturedSql = ''
  const dataSource = {
    query: vi.fn((sql: string) => {
      capturedSql = sql
      return Promise.resolve(queryResult)
    }),
  }
  const assetRepo = { findOne: vi.fn(() => Promise.resolve({ id: 'asset-1', userId: 'u1' })) }
  const assets = {
    listByIdsRanked: vi.fn((_userId: string, ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id }))),
    ),
  }
  const service = new GroupsService(
    dataSource as never,
    assets as never,
    assetRepo as never,
    {} as never,
  )
  return { service, dataSource, assets, captured: () => capturedSql }
}

describe('GroupsService.duplicates bound (C7-limit-only)', () => {
  it('bounds the SQL with LIMIT 200', async () => {
    const { service, captured } = makeService([])
    await service.duplicates('u1', 'asset-1', {})
    expect(captured()).toMatch(/LIMIT 200/i)
  })

  it('caps total at the bounded row count', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `dup-${i}` }))
    const { service, assets } = makeService(rows)
    const res = await service.duplicates('u1', 'asset-1', { threshold: 10 })
    expect(res.total).toBe(200)
    expect(res.items).toHaveLength(200)
    expect(assets.listByIdsRanked).toHaveBeenCalledWith(
      'u1',
      rows.map((r) => r.id),
    )
  })
})
