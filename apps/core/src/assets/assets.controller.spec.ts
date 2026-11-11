import type { Response } from 'express';
import { BadRequestException } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import type { AssetsService } from './assets.service';

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: new Map<string, string>(),
    jsonBody: undefined as unknown,
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
    controller: new AssetsController({
      layout,
      layoutMonths,
    } as unknown as AssetsService),
  };
}

describe('AssetsController layout', () => {
  it('window page returns the paged body', async () => {
    const body = {
      from: '2024-03-01T00:00:00.000Z',
      to: '2024-04-01T00:00:00.000Z',
      version: '3-1700000000000-0-0',
      total: 3,
      items: [{ t: '2024-03-02T10:00:00.000Z', w: 4, h: 3 }],
      nextOffset: 1,
    };
    const { controller, layout } = makeController(body);
    const res = fakeRes();

    await controller.layout(res as unknown as Response, 'u1', {
      from: body.from,
      to: body.to,
      offset: 0,
      limit: 1,
    });

    expect(layout).toHaveBeenCalledWith('u1', undefined, undefined, undefined, {
      from: new Date(body.from),
      to: new Date(body.to),
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

    await controller.layout(fakeRes() as unknown as Response, 'u1', {
      from: '2024-03-01T00:00:00.000Z',
      to: '2024-04-01T00:00:00.000Z',
    });

    expect(layout).toHaveBeenCalledWith('u1', undefined, undefined, undefined, {
      from: new Date('2024-03-01T00:00:00.000Z'),
      to: new Date('2024-04-01T00:00:00.000Z'),
      offset: 0,
      limit: 2000,
    });
  });

  it('rejects a half-supplied range and a windowless read', async () => {
    const { controller, layout } = makeController({ items: [] });

    await expect(
      controller.layout(fakeRes() as unknown as Response, 'u1', {
        from: '2024-03-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.layout(fakeRes() as unknown as Response, 'u1', {
        to: '2024-04-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.layout(fakeRes() as unknown as Response, 'u1', { offset: 2000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // falsy but present: zero offset and a bare limit are still paging requests
    await expect(
      controller.layout(fakeRes() as unknown as Response, 'u1', { offset: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.layout(fakeRes() as unknown as Response, 'u1', { limit: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // the whole-library body is gone, so a bare read is a 400 too
    await expect(
      controller.layout(fakeRes() as unknown as Response, 'u1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(layout).not.toHaveBeenCalled();
  });
});

describe('AssetsController layout months', () => {
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
    const { controller, layoutMonths } = makeController({ items: [] });
    layoutMonths.mockResolvedValue(body);
    const res = fakeRes();

    await controller.layoutMonths(res as unknown as Response, 'u1', {
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
