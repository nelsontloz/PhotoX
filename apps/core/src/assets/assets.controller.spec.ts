import type { Request, Response } from 'express'
import { AssetsController, layoutEtag } from './assets.controller'
import type { AssetsService } from './assets.service'

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: new Map<string, string>(),
    jsonBody: undefined as unknown,
    ended: false,
    status(code: number) {
      res.statusCode = code
      return res
    },
    setHeader(name: string, value: string) {
      res.headers.set(name, value)
      return res
    },
    json(body: unknown) {
      res.jsonBody = body
      return res
    },
    end() {
      res.ended = true
      return res
    },
  }
  return res
}

function fakeReq(fresh: boolean): Request {
  return {
    user: { id: 'u1' },
    fresh,
  } as unknown as Request
}

function makeController(fingerprint: { count: number; maxUpdatedAtMs: number }, body: unknown) {
  const layoutFingerprint = vi.fn().mockResolvedValue(fingerprint)
  const layout = vi.fn().mockResolvedValue(body)
  return {
    layoutFingerprint,
    layout,
    controller: new AssetsController({ layoutFingerprint, layout } as unknown as AssetsService),
  }
}

describe('AssetsController layout ETag', () => {
  it('cold GET fetches layout once and sends body with revalidation headers', async () => {
    const body = { items: [{ t: '2024-01-01T00:00:00.000Z', w: 4, h: 3 }] }
    const { controller, layoutFingerprint, layout } = makeController(
      { count: 2, maxUpdatedAtMs: 1700000000000 },
      body,
    )
    const res = fakeRes()

    await controller.layout(fakeReq(false), res as unknown as Response)

    expect(layoutFingerprint).toHaveBeenCalledTimes(1)
    expect(layoutFingerprint).toHaveBeenCalledWith('u1')
    expect(layout).toHaveBeenCalledTimes(1)
    expect(layout).toHaveBeenCalledWith('u1', undefined, undefined, undefined)
    expect(res.jsonBody).toEqual(body)
    expect(res.headers.get('ETag')).toBe('"layout-2-1700000000000"')
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(res.headers.get('Vary')).toBe('Authorization')
  })

  it('returns 304 and skips layout when the request is fresh', async () => {
    const { controller, layout } = makeController(
      { count: 2, maxUpdatedAtMs: 1700000000000 },
      { items: [] },
    )
    const res = fakeRes()

    await controller.layout(fakeReq(true), res as unknown as Response)

    expect(res.statusCode).toBe(304)
    expect(res.ended).toBe(true)
    expect(res.jsonBody).toBeUndefined()
    expect(layout).not.toHaveBeenCalled()
  })

  it('refetches and returns 200 when the request is not fresh', async () => {
    const body = { items: [] }
    const { controller, layout } = makeController({ count: 1, maxUpdatedAtMs: 5 }, body)
    const res = fakeRes()

    await controller.layout(fakeReq(false), res as unknown as Response)

    expect(res.statusCode).toBe(200)
    expect(res.jsonBody).toEqual(body)
    expect(layout).toHaveBeenCalledTimes(1)
    expect(res.headers.get('ETag')).toBe('"layout-1-5"')
  })

  it('skips ETag revalidation for person-scoped layouts', async () => {
    const body = { items: [{ t: '2024-01-01T00:00:00.000Z', w: 4, h: 3 }] }
    const { controller, layoutFingerprint, layout } = makeController(
      { count: 2, maxUpdatedAtMs: 1700000000000 },
      body,
    )
    const res = fakeRes()

    // fresh conditional request still gets the body: the fingerprint can't see face→person moves
    await controller.layout(fakeReq(true), res as unknown as Response, 'p-1')

    expect(layoutFingerprint).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(res.jsonBody).toEqual(body)
    expect(layout).toHaveBeenCalledWith('u1', 'p-1', undefined, undefined)
    expect(res.headers.get('ETag')).toBeUndefined()
  })

  it('skips ETag revalidation for favorite-scoped layouts', async () => {
    const body = { items: [{ t: '2024-01-01T00:00:00.000Z', w: 4, h: 3 }] }
    const { controller, layoutFingerprint, layout } = makeController(
      { count: 2, maxUpdatedAtMs: 1700000000000 },
      body,
    )
    const res = fakeRes()

    // fresh conditional request still gets the body: the fingerprint can't see album membership
    await controller.layout(fakeReq(true), res as unknown as Response, undefined, true)

    expect(layoutFingerprint).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(res.jsonBody).toEqual(body)
    expect(layout).toHaveBeenCalledWith('u1', undefined, true, undefined)
    expect(res.headers.get('ETag')).toBeUndefined()
  })
})

describe('layoutEtag', () => {
  it('quotes the count and timestamp', () => {
    expect(layoutEtag({ count: 3, maxUpdatedAtMs: 42 })).toBe('"layout-3-42"')
  })
})
