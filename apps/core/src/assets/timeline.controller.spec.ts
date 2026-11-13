import type { Response } from 'express';
import { TimelineController } from './timeline.controller';
import type { AssetsService } from './assets.service';

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: new Map<string, string>(),
    rawBody: undefined as string | undefined,
    ended: false,
    setHeader(name: string, value: string) {
      res.headers.set(name, value);
      return res;
    },
    vary(name: string) {
      const prev = res.headers.get('Vary');
      res.headers.set('Vary', prev ? `${prev}, ${name}` : name);
      return res;
    },
    end(chunk?: string) {
      res.ended = true;
      res.rawBody = chunk;
      return res;
    },
  };
  return res;
}

function makeController(body: unknown) {
  const layout = vi.fn().mockResolvedValue(body);
  const layoutMonths = vi.fn().mockResolvedValue({ months: [] });
  return {
    layout,
    layoutMonths,
    controller: new TimelineController({
      layout,
      layoutMonths,
    } as unknown as AssetsService),
  };
}

describe('TimelineController window', () => {
  const from = '2024-03-01T00:00:00.000Z';
  const to = '2024-04-01T00:00:00.000Z';

  it('returns the paged body with the revalidation headers and no ETag', async () => {
    const body = {
      from,
      to,
      version: '3-1700000000000-0-0',
      total: 3,
      items: [{ t: '2024-03-02T10:00:00.000Z', w: 4, h: 3 }],
      nextOffset: 1,
    };
    const { controller, layout } = makeController(body);
    const res = fakeRes();

    await controller.window(res as unknown as Response, 'u1', { from, to, offset: 0, limit: 1 });

    expect(layout).toHaveBeenCalledWith('u1', undefined, undefined, undefined, {
      from: new Date(from),
      to: new Date(to),
      offset: 0,
      limit: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.rawBody!)).toEqual(body);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(res.headers.get('Vary')).toBe('Authorization');
    expect(res.headers.get('ETag')).toBeUndefined();
  });

  it('defaults offset/limit when a window omits them', async () => {
    const { controller, layout } = makeController({ items: [] });

    await controller.window(fakeRes() as unknown as Response, 'u1', {
      from,
      to,
      personId: 'p-1',
    });

    expect(layout).toHaveBeenCalledWith('u1', 'p-1', undefined, undefined, {
      from: new Date(from),
      to: new Date(to),
      offset: 0,
      limit: 2000,
    });
  });
});

describe('TimelineController index', () => {
  it('sends the month index uncached with the Authorization vary', async () => {
    const body = {
      months: [
        {
          key: '2024-03',
          from: '2024-02-29T23:00:00.000Z',
          to: '2024-03-31T22:00:00.000Z',
          count: 2,
          version: '2-1700000000000-0-0',
        },
      ],
    };
    const { controller, layoutMonths } = makeController({ months: [] });
    layoutMonths.mockResolvedValue(body);
    const res = fakeRes();

    await controller.index(res as unknown as Response, 'u1', {
      tz: 'Europe/Madrid',
      albumId: 'a-1',
    });

    expect(layoutMonths).toHaveBeenCalledWith('u1', undefined, undefined, 'a-1', 'Europe/Madrid');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.rawBody!)).toEqual(body);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toBe('Authorization');
    expect(res.headers.get('ETag')).toBeUndefined();
  });
});
