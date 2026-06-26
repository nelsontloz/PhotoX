/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
export interface MockRepos {
  mockUserRepo: ReturnType<typeof createMockRepo>
  mockRefreshTokenRepo: ReturnType<typeof createMockRepo>
}

export function createMockRepo() {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockImplementation((data: any) => ({
      ...data,
      id: data.id ?? 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: data.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: data.updatedAt ?? new Date('2024-01-01T00:00:00.000Z'),
      expiresAt: data.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })),
    create: vi.fn((data: any) => data),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    find: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    }),
    count: vi.fn().mockResolvedValue(0),
  }
}
