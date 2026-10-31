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
