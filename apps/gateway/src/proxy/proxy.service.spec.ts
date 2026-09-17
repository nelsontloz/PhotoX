import type { Request, Response } from 'express'
import { Writable } from 'node:stream'
import { ProxyService } from './proxy.service'

class FakeRes extends Writable {
  statusCode = 200
  // ponytail: Writable has no headersSent — declared here so forward() reads it like express
  headersSent = false
  headers: Record<string, string> = {}
  chunks: Buffer[] = []

  status(code: number): this {
    this.statusCode = code
    return this
  }

  setHeader(name: string, value: string | string[]): this {
    this.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
    this.headersSent = true
    return this
  }

  appendHeader(name: string, value: string): this {
    return this.setHeader(name, value)
  }

  override _write(
    chunk: unknown,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk as Uint8Array))
    callback()
  }

  text(): string {
    return Buffer.concat(this.chunks).toString()
  }
}

function fakeReq(url: string, headers: Record<string, string> = {}): Request {
  return {
    method: 'GET',
    originalUrl: url,
    headers,
    user: { id: 'u1', email: 'u@example.com', role: 'user' },
    on: () => ({}),
  } as unknown as Request
}

describe('ProxyService.forward', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('pipes status, headers and body; strips userId; attaches identity', async () => {
    vi.stubEnv('CORE_BASE_URL', 'http://core:3000')
    const seen: { url: string; init: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        seen.push({ url, init })
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-request-id': 'r1' },
          }),
        )
      }),
    )

    const res = new FakeRes()
    await new ProxyService().forward(
      fakeReq('/api/v1/assets?userId=evil&limit=20', {
        authorization: 'Bearer abc',
        'x-request-id': 'r1',
        'x-user-id': 'spoofed',
      }),
      res as unknown as Response,
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('http://core:3000/api/v1/assets?limit=20')
    const outHeaders = seen[0]?.init.headers as Record<string, string>
    expect(outHeaders.authorization).toBeUndefined()
    expect(outHeaders['x-user-id']).toBe('u1')
    expect(outHeaders['x-user-email']).toBe('u@example.com')
    expect(outHeaders['x-user-role']).toBe('user')
    expect(outHeaders['x-request-id']).toBe('r1')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/json')
    expect(res.text()).toBe(JSON.stringify({ ok: true }))
  })

  it('preserves 206 + content-range and maps core unreachable to 502', async () => {
    vi.stubEnv('CORE_BASE_URL', 'http://core:3000')
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('0123456789', {
            status: 206,
            headers: {
              'content-type': 'video/mp4',
              'content-range': 'bytes 0-9/100',
              'accept-ranges': 'bytes',
            },
          }),
        ),
      ),
    )
    const res = new FakeRes()
    await new ProxyService().forward(
      fakeReq('/api/v1/files/f1/stream', { range: 'bytes=0-9' }),
      res as unknown as Response,
    )
    expect(res.statusCode).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 0-9/100')
    expect(res.text()).toBe('0123456789')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('refused'))),
    )
    const res2 = new FakeRes()
    await expect(
      new ProxyService().forward(fakeReq('/api/v1/assets'), res2 as unknown as Response),
    ).rejects.toMatchObject({ status: 502 })
  })
})
