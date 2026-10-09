import { randomUUID } from 'node:crypto'
import { JwtService } from '@nestjs/jwt'
import { UnrecoverableError } from 'bullmq'
import { CoreClient } from './core-client.service'

const fetchMock = vi.fn()

function makeClient(): CoreClient {
  return new CoreClient(new JwtService({ secret: 'x'.repeat(32) }))
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

describe('CoreClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends a per-user delegated bearer token and returns the body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'file-1', userId: 'user-1' }))

    const file = await makeClient().getFile('user-1', 'file-1')

    expect(file).toEqual({ id: 'file-1', userId: 'user-1' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/v1/files/file-1')
    expect(init.method).toBe('GET')
    const token = (init.headers as Record<string, string>).Authorization!.replace('Bearer ', '')
    const payload = new JwtService({ secret: 'x'.repeat(32) }).verify<{
      sub: string
      email: string
      role: string
      iat: number
      exp: number
    }>(token)
    expect(payload).toMatchObject({
      sub: 'user-1',
      email: 'worker@internal',
      role: 'user',
      act: { sub: 'worker-service' },
    })
    expect(payload.exp).toBeGreaterThan(payload.iat)
  })

  it('maps 404 to UnrecoverableError without retrying', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'File not found' }))

    await expect(makeClient().getFile('user-1', 'file-1')).rejects.toBeInstanceOf(
      UnrecoverableError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([400, 422])('maps %i to UnrecoverableError without retrying', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { message: 'bad' }))

    await expect(makeClient().getAsset('user-1', 'asset-1')).rejects.toBeInstanceOf(
      UnrecoverableError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails fast on 401/403 without in-process retries', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }))

    await expect(makeClient().getAsset('user-1', 'asset-1')).rejects.toThrow('401')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws a plain Error on 5xx without in-process retries (BullMQ owns retries)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { message: 'unavailable' }))

    await expect(makeClient().getAsset('user-1', 'asset-1')).rejects.toThrow('503')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws a plain Error on network failures immediately', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(makeClient().getAsset('user-1', 'asset-1')).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetches cluster faces with embeddings and trashed assets excluded', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [{ id: 'face-1' }] }))

    const faces = await makeClient().getFacesForCluster('user-1')

    expect(faces).toEqual([{ id: 'face-1' }])
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://localhost:3000/api/v1/faces?includeEmbeddings=true&excludeTrashed=true',
    )
  })

  it('chunks asset id lookups at 100 ids per request', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 0, offset: 0 })),
    )
    const ids = Array.from({ length: 205 }, () => randomUUID())

    await makeClient().getAssetsByIds('user-1', ids)

    const urls = fetchMock.mock.calls.map((call) => call[0] as string)
    expect(urls).toHaveLength(3)
    expect(urls.map((url) => url.split('ids=')[1]!.split(',').length)).toEqual([100, 100, 5])
  })

  it('applies a cluster plan with both arrays present and no null covers', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { created: 1, assigned: 2 }))

    const result = await makeClient().applyClusters('user-1', {
      creates: [{ clusterLabel: 'cluster-x', faceIds: ['f1', 'f2'] }],
      attaches: [],
    })

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as unknown
    expect(body).toEqual({
      creates: [{ clusterLabel: 'cluster-x', faceIds: ['f1', 'f2'] }],
      attaches: [],
    })
    expect(result).toEqual({ created: 1, assigned: 2 })
  })

  it('registers faces with the resolved detector in the body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { count: 1 }))

    const result = await makeClient().registerFaces(
      'user-1',
      'asset-1',
      [{ box: { x: 1, y: 2, w: 3, h: 4 }, confidence: 0.9, embedding: [0.1, 0.2] }],
      'scrfd',
    )

    expect(result).toEqual({ count: 1 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/v1/assets/asset-1/faces')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      userId: 'user-1',
      detector: 'scrfd',
      faces: [{ box: { x: 1, y: 2, w: 3, h: 4 }, confidence: 0.9, embedding: [0.1, 0.2] }],
    })
  })

  it('deletes a file via the admin endpoint with an admin token and no body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.resolve(undefined),
      text: () => Promise.resolve(''),
    })

    await makeClient().adminDeleteFile('file-1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/v1/admin/files/file-1')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
    const token = (init.headers as Record<string, string>).Authorization!.replace('Bearer ', '')
    const payload = new JwtService({ secret: 'x'.repeat(32) }).verify<{
      sub: string
      role: string
    }>(token)
    expect(payload).toMatchObject({
      sub: 'worker-service',
      role: 'admin',
      act: { sub: 'worker-service' },
    })
  })

  it('runs the inline orphan cleanup with a 120s timeout and no body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { deletedFiles: 1, deletedThumbnails: 2, deletedStrays: 3 }),
    )
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal)

    const result = await makeClient().adminRunOrphanCleanup()

    expect(result).toEqual({ deletedFiles: 1, deletedThumbnails: 2, deletedStrays: 3 })
    expect(timeoutSpy).toHaveBeenCalledWith(120_000)
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    timeoutSpy.mockRestore()
  })

  it('fetches face detection settings with an admin token', async () => {
    const settings = { detector: 'scrfd', envDefault: 'human', models: { scrfd: true } }
    fetchMock.mockResolvedValue(jsonResponse(200, settings))

    const result = await makeClient().getFaceDetectionSettings()

    expect(result).toEqual(settings)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/v1/admin/face-detection')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    const token = (init.headers as Record<string, string>).Authorization!.replace('Bearer ', '')
    const payload = new JwtService({ secret: 'x'.repeat(32) }).verify<{
      sub: string
      role: string
    }>(token)
    expect(payload).toMatchObject({
      sub: 'worker-service',
      role: 'admin',
      act: { sub: 'worker-service' },
    })
  })
})
