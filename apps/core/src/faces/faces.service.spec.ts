import { NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import type { LocalStorageService } from '@photox/shared-config';
import type { Asset, AssetThumbnail, Face, FileRecord, Person } from '../database/entities';
import { FacesService } from './faces.service';

describe('FacesService getThumb single-flight', () => {
  function makeService(): FacesService {
    return new FacesService(
      {} as Repository<Face>,
      {} as Repository<Person>,
      {} as Repository<Asset>,
      {} as Repository<AssetThumbnail>,
      {} as Repository<FileRecord>,
      {} as DataSource,
      {} as LocalStorageService,
    );
  }

  function renderThumbSpy(service: FacesService) {
    return vi.spyOn(
      service as unknown as {
        renderThumb: (faceId: string, userId: string, target: number) => Promise<Buffer>;
      },
      'renderThumb',
    );
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it('single-flights identical in-flight renders and clears the key after settle', async () => {
    const service = makeService();
    const firstRender = deferred<Buffer>();
    const spy = renderThumbSpy(service).mockReturnValueOnce(firstRender.promise);

    const first = service.getThumb('face-1', 'owner', 240);
    const second = service.getThumb('face-1', 'owner', 240);
    expect(spy).toHaveBeenCalledTimes(1);

    // both calls adopt the one in-flight job, so they resolve to the identical buffer
    const buf = Buffer.from('jpeg');
    firstRender.resolve(buf);
    await expect(first).resolves.toBe(buf);
    await expect(second).resolves.toBe(buf);

    const nextRender = deferred<Buffer>();
    spy.mockReturnValueOnce(nextRender.promise);
    const third = service.getThumb('face-1', 'owner', 240);
    expect(spy).toHaveBeenCalledTimes(2);
    nextRender.resolve(Buffer.from('jpeg'));
    await expect(third).resolves.toEqual(Buffer.from('jpeg'));
  });

  it('keys in-flight renders by owner and size', async () => {
    const service = makeService();
    const renders: ReturnType<typeof deferred<Buffer>>[] = [];
    const spy = renderThumbSpy(service).mockImplementation(() => {
      const d = deferred<Buffer>();
      renders.push(d);
      return d.promise;
    });

    const owner = service.getThumb('face-1', 'owner', 240);
    const otherUser = service.getThumb('face-1', 'someone-else', 240);
    const otherSize = service.getThumb('face-1', 'owner', 320);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(new Set([owner, otherUser, otherSize]).size).toBe(3);

    for (const d of renders) d.resolve(Buffer.from('jpeg'));
    await Promise.all([owner, otherUser, otherSize]);
  });
});

/**
 * `assignPerson` now answers the updated face (the PUT/PATCH wire shape) instead of `void`.
 * Assignment semantics and `Person.faceCount` bookkeeping stay unchanged.
 */
function makeAssignFace(over: Partial<Face> = {}): Face {
  return {
    id: 'face-1',
    assetId: 'asset-1',
    userId: 'user-1',
    box: { x: 1, y: 2, w: 10, h: 10 },
    confidence: 0.9,
    embedding: [0.1, 0.2, 0.3],
    personId: null,
    createdAt: new Date(),
    ...over,
  };
}

function makeAssignPerson(over: Partial<Person> = {}): Person {
  return {
    id: 'person-1',
    userId: 'user-1',
    name: null,
    coverFaceId: null,
    clusterLabel: null,
    faceCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeAssignService(opts: { face?: Face | null; person?: Person | null } = {}) {
  const face = opts.face === undefined ? makeAssignFace() : opts.face;
  const person = opts.person === undefined ? makeAssignPerson() : opts.person;

  const countQuery = {
    innerJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getRawOne: vi.fn().mockResolvedValue({ count: '1' }),
  };
  const faceRepo = {
    findOne: vi.fn().mockResolvedValue(face),
    save: vi.fn((row: Face) => Promise.resolve(row)),
    createQueryBuilder: vi.fn().mockReturnValue(countQuery),
  } as unknown as Repository<Face>;
  const update = vi.fn((criteria: unknown, partial: Partial<Person>) => {
    void criteria;
    void partial;
    return Promise.resolve({ affected: 1 });
  });
  const personRepo = {
    findOne: vi.fn().mockResolvedValue(person),
    update,
  } as unknown as Repository<Person>;

  const nil = undefined as never;
  const service = new FacesService(faceRepo, personRepo, nil, nil, nil, nil, nil);
  return { service, faceRepo, personRepo, countQuery, update };
}

describe('FacesService.assignPerson', () => {
  it('returns the updated FaceDto when assigning a person', async () => {
    const face = makeAssignFace();
    const person = makeAssignPerson();
    const { service } = makeAssignService({ face, person });

    const dto = await service.assignPerson('user-1', face.id, person.id);

    expect(dto).toEqual({
      id: face.id,
      assetId: face.assetId,
      box: face.box,
      confidence: face.confidence,
      personId: person.id,
    });
  });

  it('returns the FaceDto with personId null when unassigning', async () => {
    const face = makeAssignFace({ personId: 'person-1' });
    const { service } = makeAssignService({ face });

    const dto = await service.assignPerson('user-1', face.id, null);

    expect(dto).toMatchObject({ id: face.id, assetId: face.assetId, personId: null });
  });

  it('keeps refreshing Person.faceCount on both the old and the new person', async () => {
    const face = makeAssignFace({ personId: 'old-person' });
    const { service, update } = makeAssignService({ face });

    await service.assignPerson('user-1', face.id, 'new-person');

    expect(update.mock.calls.length).toBe(2);
    expect(update.mock.calls[0]?.[1]).toEqual({ faceCount: 1 });
    expect(update.mock.calls[1]?.[1]).toEqual({ faceCount: 1 });
  });

  it('still 404s a person owned by another user', async () => {
    const face = makeAssignFace();
    const { service } = makeAssignService({ face, person: null });

    await expect(service.assignPerson('user-1', face.id, 'foreign-person')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('still 404s a face owned by another user', async () => {
    const { service } = makeAssignService({ face: null });

    await expect(service.assignPerson('user-1', 'foreign-face', null)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
