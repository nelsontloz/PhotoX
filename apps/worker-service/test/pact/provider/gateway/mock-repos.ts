/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
export interface MockRepos {
  mockJobRepo: ReturnType<typeof createJobRepo>
}

export function createJobRepo() {
  const store: Record<string, any> = {}

  return {
    findOne: vi.fn().mockImplementation((opts: any) => {
      if (!opts?.where) return Promise.resolve(null)
      const key = `${opts.where.assetId ?? ''}:${opts.where.size ?? ''}`
      return Promise.resolve(store[key] ?? null)
    }),
    save: vi.fn().mockImplementation((data: any) => {
      const id = data.id ?? 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
      const key = `${data.assetId ?? ''}:${data.size ?? ''}`
      const record = { ...data, id, createdAt: new Date(), updatedAt: new Date() }
      store[key] = record
      return Promise.resolve(record)
    }),
    create: vi.fn((data: any) => data),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  }
}
