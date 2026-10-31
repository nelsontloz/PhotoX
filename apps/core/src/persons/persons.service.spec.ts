import { PersonsService } from './persons.service';

function chain(result: unknown) {
  const qb = {
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    andWhere: vi.fn(),
    getRawOne: vi.fn(() => Promise.resolve(result)),
  } as unknown as {
    innerJoin: (...args: unknown[]) => unknown;
    select: (...args: unknown[]) => unknown;
    where: (...args: unknown[]) => unknown;
    andWhere: (...args: unknown[]) => unknown;
    getRawOne: () => Promise<unknown>;
  };
  const self = qb as unknown as Record<string, { mockReturnValue: (v: unknown) => unknown }>;
  self.innerJoin!.mockReturnValue(qb);
  self.select!.mockReturnValue(qb);
  self.where!.mockReturnValue(qb);
  self.andWhere!.mockReturnValue(qb);
  return qb;
}

function makeService(countResult: { count: string }) {
  const person = {
    id: 'person-1',
    userId: 'u1',
    name: 'Old',
    coverFaceId: null,
    clusterLabel: null,
    faceCount: 7,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  };
  const personRepo = {
    findOne: vi.fn(() => Promise.resolve({ ...person })),
    update: vi.fn(() => Promise.resolve({ affected: 1 })),
  };
  const qb = chain(countResult);
  const faceRepo = { createQueryBuilder: vi.fn(() => qb) };
  const service = new PersonsService(personRepo as never, faceRepo as never, {} as never);
  return { service, personRepo, faceRepo, qb };
}

describe('PersonsService.update live count (C4)', () => {
  it('returns the live non-trashed count, not the stored faceCount', async () => {
    const { service } = makeService({ count: '0' });
    const res = await service.update('u1', 'person-1', 'New');
    // stored row had faceCount 7; live count is 0 after its asset was trashed/deleted
    expect(res.faceCount).toBe(0);
  });

  it('reflects the live count when faces remain', async () => {
    const { service } = makeService({ count: '3' });
    const res = await service.update('u1', 'person-1', 'New');
    expect(res.faceCount).toBe(3);
  });
});
