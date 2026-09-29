import type { Request, Response } from 'express'
import { AssetsController, etagMatches, layoutEtag } from './assets.controller'
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

function fakeReq(ifNoneMatch?: string): Request {
  return {
    user: { id: 'u1' },
    get: (header: string) => (header === 'If-None-Match' ? ifNoneMatch : undefined),
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

    await controller.layout(fakeReq(), res as unknown as Response)

    expect(layoutFingerprint).toHaveBeenCalledTimes(1)
    expect(layoutFingerprint).toHaveBeenCalledWith('u1')
    expect(layout).toHaveBeenCalledTimes(1)
    expect(layout).toHaveBeenCalledWith('u1')
    expect(res.jsonBody).toEqual(body)
    expect(res.headers.get('ETag')).toBe('"layout-2-1700000000000"')
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(res.headers.get('Vary')).toBe('Authorization')
  })

  it('returns 304 and skips layout when If-None-Match matches', async () => {
    const { controller, layout } = makeController(
      { count: 2, maxUpdatedAtMs: 1700000000000 },
      { items: [] },
    )
    const res = fakeRes()

    await controller.layout(fakeReq('"layout-2-1700000000000"'), res as unknown as Response)

    expect(res.statusCode).toBe(304)
    expect(res.ended).toBe(true)
    expect(res.jsonBody).toBeUndefined()
    expect(layout).not.toHaveBeenCalled()
  })

  it('matches weak ETag prefixes', async () => {
    const { controller, layout } = makeController({ count: 0, maxUpdatedAtMs: 0 }, { items: [] })
    const res = fakeRes()

    await controller.layout(fakeReq('W/"layout-0-0"'), res as unknown as Response)

    expect(res.statusCode).toBe(304)
    expect(res.ended).toBe(true)
    expect(layout).not.toHaveBeenCalled()
  })

  it('refetches and returns 200 when If-None-Match differs', async () => {
    const body = { items: [] }
    const { controller, layout } = makeController({ count: 1, maxUpdatedAtMs: 5 }, body)
    const res = fakeRes()

    await controller.layout(fakeReq('"layout-9-9"'), res as unknown as Response)

    expect(res.statusCode).toBe(200)
    expect(res.jsonBody).toEqual(body)
    expect(layout).toHaveBeenCalledTimes(1)
    expect(res.headers.get('ETag')).toBe('"layout-1-5"')
  })
})

describe('etagMatches', () => {
  it('returns false for a missing header', () => {
    expect(etagMatches(undefined, '"x"')).toBe(false)
  })

  it('matches *', () => {
    expect(etagMatches('*', '"x"')).toBe(true)
  })

  it('matches an entry in a weak-prefixed comma list', () => {
    expect(etagMatches('W/"a", W/"b"', '"b"')).toBe(true)
  })

  it('does not match other values', () => {
    expect(etagMatches('"a", W/"c"', '"b"')).toBe(false)
  })
})

describe('layoutEtag', () => {
  it('quotes the count and timestamp', () => {
    expect(layoutEtag({ count: 3, maxUpdatedAtMs: 42 })).toBe('"layout-3-42"')
  })
})
