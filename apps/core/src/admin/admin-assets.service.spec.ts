import type { DataSource, Repository } from 'typeorm'
import { Asset, AssetThumbnail, FileRecord } from '../database/entities'
import { AdminAssetsService } from './admin-assets.service'

type Row = Record<string, unknown>

interface StatsQueryResults {
  counts?: Row[]
  weeks?: Row[]
  months?: Row[]
}

function makeService(responses: StatsQueryResults) {
  const query = vi.fn((sql: string) => {
    if (sql.includes('WITH weeks')) return Promise.resolve(responses.weeks ?? [])
    if (sql.includes('WITH bounds')) return Promise.resolve(responses.months ?? [])
    return Promise.resolve(responses.counts ?? [])
  })
  const service = new AdminAssetsService(
    {} as unknown as Repository<Asset>,
    { query } as unknown as DataSource,
    {} as unknown as Repository<FileRecord>,
    {} as unknown as Repository<AssetThumbnail>,
    {} as never,
  )
  return { service, query }
}

describe('AdminAssetsService.getLibraryStats', () => {
  it('assembles counts, weekly uploads and monthly storage with Number conversion', async () => {
    const { service, query } = makeService({
      counts: [{ photos: '12', videos: '3', trashed: '2' }],
      weeks: [{ week: '2026-09-28', photos: '4', videos: '1' }],
      months: [
        {
          month: '2026-08-01',
          originalsBytes: '1000',
          transcodesBytes: '500',
          thumbnailsBytes: '100',
        },
      ],
    })

    await expect(service.getLibraryStats()).resolves.toEqual({
      counts: { photos: 12, videos: 3, trashed: 2 },
      uploadsByWeek: [{ week: '2026-09-28', photos: 4, videos: 1 }],
      storageByMonth: [
        {
          month: '2026-08-01',
          originalsBytes: 1000,
          transcodesBytes: 500,
          thumbnailsBytes: 100,
        },
      ],
    })
    expect(query).toHaveBeenCalledTimes(3)
  })

  it('maps null sums and missing rows to zero defaults', async () => {
    const { service } = makeService({
      counts: [],
      weeks: [],
      months: [
        {
          month: '2026-09-01',
          originalsBytes: null,
          transcodesBytes: null,
          thumbnailsBytes: null,
        },
      ],
    })

    await expect(service.getLibraryStats()).resolves.toEqual({
      counts: { photos: 0, videos: 0, trashed: 0 },
      uploadsByWeek: [],
      storageByMonth: [
        {
          month: '2026-09-01',
          originalsBytes: 0,
          transcodesBytes: 0,
          thumbnailsBytes: 0,
        },
      ],
    })
  })

  it('returns empty series when the database has no qualifying rows', async () => {
    const { service } = makeService({})

    await expect(service.getLibraryStats()).resolves.toEqual({
      counts: { photos: 0, videos: 0, trashed: 0 },
      uploadsByWeek: [],
      storageByMonth: [],
    })
  })
})
