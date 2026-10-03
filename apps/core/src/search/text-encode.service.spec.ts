import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServiceUnavailableException } from '@nestjs/common'
import { TextEncodeService } from './text-encode.service'

class FakeEncoder extends TextEncodeService {
  readonly calls: string[] = []

  protected override encodeUncached(query: string): Promise<number[]> {
    this.calls.push(query)
    return Promise.resolve([this.calls.length])
  }
}

describe('TextEncodeService LRU cache', () => {
  it('encodes once per distinct query and reuses the cached vector', async () => {
    const service = new FakeEncoder()
    const first = await service.encode('red square')
    const second = await service.encode('red square')
    expect(second).toBe(first)
    expect(service.calls).toEqual(['red square'])
  })

  it('trims the query before caching', async () => {
    const service = new FakeEncoder()
    const first = await service.encode('  red square  ')
    const second = await service.encode('red square')
    expect(second).toBe(first)
    expect(service.calls).toEqual(['red square'])
  })

  it('evicts the least-recently-used entry past 256', async () => {
    const service = new FakeEncoder()
    for (let i = 0; i < 256; i++) await service.encode(`q${i}`)
    await service.encode('q0') // cache hit refreshes q0
    await service.encode('q256') // miss; evicts q1, the oldest
    expect(service.calls).toHaveLength(257)
    await service.encode('q1') // was evicted -> re-encoded
    expect(service.calls).toHaveLength(258)
  })
})

describe('TextEncodeService provisioning', () => {
  const prevStorageDir = process.env.STORAGE_DIR

  afterEach(() => {
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
  })

  it('503s when the text model is not provisioned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'photox-search-'))
    process.env.STORAGE_DIR = dir
    try {
      const service = new TextEncodeService()
      await expect(service.encode('red square')).rejects.toBeInstanceOf(ServiceUnavailableException)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
