/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
export const ASSET_DEFAULTS = {
  isTrashed: false,
  trashedAt: null,
  title: null,
  description: null,
  takenAt: null,
  favorite: false,
  mimeType: null,
  sizeBytes: null,
  originalName: null,
  width: null,
  height: null,
  durationSeconds: null,
  cameraMake: null,
  cameraModel: null,
  orientation: null,
  latitude: null,
  longitude: null,
  fps: null,
  codec: null,
  hasAudio: null,
  metadataStatus: 'pending' as const,
  metadataExtractedAt: null,
}

export interface MockRepos {
  mockAssetRepo: ReturnType<typeof createAssetRepo>
  mockThumbnailRepo: ReturnType<typeof createBasicRepo>
  mockFaceRepo: ReturnType<typeof createBasicRepo>
  mockPersonRepo: ReturnType<typeof createPersonRepo>
}

export function createAssetRepo() {
  const store: Record<string, any> = {}

  return {
    findOne: vi.fn().mockImplementation((opts: any) => {
      const id = opts?.where?.id
      if (!id) return Promise.resolve(null)
      const asset = store[id]
      if (!asset) return Promise.resolve(null)
      if (opts.where.userId && asset.userId !== opts.where.userId) return Promise.resolve(null)
      return Promise.resolve(asset)
    }),
    save: vi.fn().mockImplementation((data: any) => {
      const id = data.id ?? 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
      store[id] = {
        ...data,
        ...ASSET_DEFAULTS,
        id,
        uploadedAt: data.uploadedAt ?? new Date('2024-01-01T00:00:00.000Z'),
      }
      return Promise.resolve(store[id])
    }),
    update: vi.fn().mockImplementation((id: string, patch: any) => {
      if (store[id]) {
        store[id] = { ...store[id], ...patch }
      }
      return Promise.resolve({ affected: 1 })
    }),
    create: vi.fn((data: any) => data),
    find: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    }),
  }
}

export function createBasicRepo() {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockImplementation((data: any) => Promise.resolve(data)),
    create: vi.fn((data: any) => data),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    find: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    remove: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    }),
  }
}

export function createPersonRepo() {
  const store: Record<string, any> = {}

  return {
    findOne: vi.fn().mockImplementation((opts: any) => {
      const id = opts?.where?.id
      if (!id) return Promise.resolve(null)
      const person = store[id]
      if (!person) return Promise.resolve(null)
      if (opts.where.userId && person.userId !== opts.where.userId) return Promise.resolve(null)
      return Promise.resolve(person)
    }),
    find: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockImplementation((data: any) => {
      if (Array.isArray(data)) {
        return Promise.resolve(data)
      }
      const id = data.id ?? 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
      store[id] = {
        ...data,
        id,
        name: data.name ?? null,
        coverFaceId: data.coverFaceId ?? null,
        clusterLabel: data.clusterLabel ?? null,
        faceCount: data.faceCount ?? 0,
        createdAt: data.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: data.updatedAt ?? new Date('2024-01-01T00:00:00.000Z'),
      }
      return Promise.resolve(store[id])
    }),
    create: vi.fn((data: any) => data),
    update: vi.fn().mockImplementation((id: string, patch: any) => {
      if (store[id]) {
        store[id] = { ...store[id], ...patch }
      }
      return Promise.resolve({ affected: 1 })
    }),
    count: vi.fn().mockResolvedValue(0),
    remove: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getCount: vi.fn().mockResolvedValue(0),
      getMany: vi.fn().mockResolvedValue([]),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      getRawMany: vi.fn().mockResolvedValue([]),
      getRawOne: vi.fn().mockResolvedValue({ count: '0' }),
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      addGroupBy: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
    }),
  }
}
