/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
export interface MockRepos {
  mockFileRepo: ReturnType<typeof createFileRepo>
}

export function createFileRepo() {
  const store: Record<string, any> = {}

  return {
    findOne: vi.fn().mockImplementation((opts: any) => {
      if (!opts?.where?.id) return Promise.resolve(null)
      return Promise.resolve(store[opts.where.id] ?? null)
    }),
    save: vi.fn().mockImplementation((data: any) => {
      const id = data.id ?? 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
      store[id] = {
        ...data,
        id,
        createdAt: data.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
      }
      return Promise.resolve(store[id])
    }),
    create: vi.fn((data: any) => ({
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      ...data,
    })),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    remove: vi.fn().mockImplementation((record: any) => {
      if (record.id) delete store[record.id]
      return Promise.resolve(record)
    }),
    find: vi.fn().mockResolvedValue([]),
    createQueryBuilder: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    }),
  }
}
