import type { Request, Response } from 'express';
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
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers.set(name, value);
      return res;
    },
    vary(name: string) {
      const prev = res.headers.get('Vary');
      res.headers.set('Vary', prev ? `${prev}, ${name}` : name);
      return res;
    },
    json(body: unknown) {
      res.jsonBody = body;
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

function fakeReq(fresh: boolean): Request {
  return { fresh } as unknown as Request;
}

interface LayoutFingerprint {
  count: number;
  maxUpdatedAtMs: number;
  hiddenCount: number;
  hiddenMaxTouchedMs: number;
}

function makeController(fingerprint: LayoutFingerprint, body: unknown) {
  const layoutFingerprint = vi.fn().mockResolvedValue(fingerprint);
  const layout = vi.fn().mockResolvedValue(body);
  const layoutMonths = vi.fn().mockResolvedValue({ months: [] });
  return {
    layoutFingerprint,
    layout,
    layoutMonths,
    controller: new AssetsController({
      layoutFingerprint,
      layout,
      layoutMonths,
    } as unknown as AssetsService),
  };
}

describe('AssetsController layout ETag', () => {
  it('cold GET fetches layout once and sends body with revalidation headers', async () => {
    const body = { items: [{ t: '2024-01-01T00:00:00.000Z', w: 4, h: 3 }] };
    const { controller, layoutFingerprint, layout } = makeController(
      {
        count: 2,
        maxUpdatedAtMs: 1700000000000,
        hiddenCount: 1,
        hiddenMaxTouchedMs: 1700000000001,
      },
      body,
    );
    const res = fakeRes();

    await controller.layout(fakeReq(false), res as unknown as Response, 'u1', {});

    expect(layoutFingerprint).toHaveBeenCalledTimes(1);
    expect(layoutFingerprint).toHaveBeenCalledWith('u1');
    expect(layout).toHaveBeenCalledTimes(1);
    expect(layout).toHaveBeenCalledWith('u1', undefined, undefined, undefined);
    expect(res.jsonBody).toEqual(body);
    expect(res.headers.get('ETag')).toBe('"layout-2-1700000000000-1-1700000000001"');
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(res.headers.get('Vary')).toBe('Authorization');
  });

  it('returns 304 and skips layout when the request is fresh', async () => {
    const { controller, layout } = makeController(
      { count: 2, maxUpdatedAtMs: 1700000000000, hiddenCount: 0, hiddenMaxTouchedMs: 0 },
      { items: [] },
    );
    const res = fakeRes();

    await controller.layout(fakeReq(true), res as unknown as Response, 'u1', {});

    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
    expect(res.jsonBody).toBeUndefined();
    expect(layout).not.toHaveBeenCalled();
  });

  it('refetches and returns 200 when the request is not fresh', async () => {
    const body = { items: [] };
    const { controller, layout } = makeController(
      { count: 1, maxUpdatedAtMs: 5, hiddenCount: 0, hiddenMaxTouchedMs: 0 },
      body,
    );
    const res = fakeRes();

    await controller.layout(fakeReq(false), res as unknown as Response, 'u1', {});

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual(body);
    expect(layout).toHaveBeenCalledTimes(1);
    expect(res.headers.get('ETag')).toBe('"layout-1-5-0-0"');
  });

  it('skips ETag revalidation for person-scoped layouts', async () => {
    const body = { items: [{ t: '2024-01-01T00:00:00.000Z', w: 4, h: 3 }] };
    const { controller, layoutFingerprint, layout } = makeController(
      { count: 2, maxUpdatedAtMs: 1700000000000, hiddenCount: 0, hiddenMaxTouchedMs: 0 },
      body,
    );
    const res = fakeRes();

    // fresh conditional request still gets the body: the fingerprint can't see face→person moves
    await controller.layout(fakeReq(true), res as unknown as Response, 'u1', { personId: 'p-1' });

    expect(layoutFingerprint).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual(body);
    expect(layout).toHaveBeenCalledWith('u1', 'p-1', undefined, undefined);
    expect(res.headers.get('ETag')).toBeUndefined();
  });

  it('skips ETag revalidation for favorite-scoped layouts', async () => {
    const body = { items: [{ t: '2024-01-01T00:00:00.000Z', w: 4, h: 3 }] };
    const { controller, layoutFingerprint, layout } = makeController(
      { count: 2, maxUpdatedAtMs: 1700000000000, hiddenCount: 0, hiddenMaxTouchedMs: 0 },
      body,
    );
    const res = fakeRes();

    // fresh conditional request still gets the body: the fingerprint can't see album membership
    await controller.layout(fakeReq(true), res as unknown as Response, 'u1', { favorite: true });

    expect(layoutFingerprint).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual(body);
    expect(layout).toHaveBeenCalledWith('u1', undefined, true, undefined);
    expect(res.headers.get('ETag')).toBeUndefined();
  });

  it('window page skips the ETag branch and returns the paged body', async () => {
    const body = {
      from: '2024-03-01T00:00:00.000Z',
      to: '2024-04-01T00:00:00.000Z',
      version: '3-1700000000000-0-0',
      total: 3,
      items: [{ t: '2024-03-02T10:00:00.000Z', w: 4, h: 3 }],
      nextOffset: 1,
    };
    const { controller, layoutFingerprint, layout } = makeController(
      { count: 2, maxUpdatedAtMs: 1700000000000, hiddenCount: 0, hiddenMaxTouchedMs: 0 },
      body,
    );
    const res = fakeRes();

    await controller.layout(fakeReq(true), res as unknown as Response, 'u1', {
      from: body.from,
      to: body.to,
      offset: 0,
      limit: 1,
    });

    expect(layoutFingerprint).not.toHaveBeenCalled();
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
    const { controller, layout } = makeController(
      { count: 0, maxUpdatedAtMs: 0, hiddenCount: 0, hiddenMaxTouchedMs: 0 },
      { items: [] },
    );

    await controller.layout(fakeReq(false), fakeRes() as unknown as Response, 'u1', {
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

  it('rejects a half-supplied range and a windowless offset', async () => {
    const { controller, layout } = makeController(
      { count: 0, maxUpdatedAtMs: 0, hiddenCount: 0, hiddenMaxTouchedMs: 0 },
      { items: [] },
    );

    await expect(
      controller.layout(fakeReq(false), fakeRes() as unknown as Response, 'u1', {
        from: '2024-03-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.layout(fakeReq(false), fakeRes() as unknown as Response, 'u1', {
        to: '2024-04-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.layout(fakeReq(false), fakeRes() as unknown as Response, 'u1', { offset: 2000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // falsy but present: zero offset and a bare limit are still paging requests
    await expect(
      controller.layout(fakeReq(false), fakeRes() as unknown as Response, 'u1', { offset: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.layout(fakeReq(false), fakeRes() as unknown as Response, 'u1', { limit: 10 }),
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
    const { controller, layoutMonths } = makeController(
      { count: 0, maxUpdatedAtMs: 0, hiddenCount: 0, hiddenMaxTouchedMs: 0 },
      { items: [] },
    );
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
