import { describe, it, expect, vi, afterEach } from 'vitest'
import { hashBytes, hashFile, setWorkerConstructorForTests, terminate } from './hash'

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const FOX_SHA256 = 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'

describe('hashBytes', () => {
  it('hashes empty input to the SHA-256 empty vector', () => {
    expect(hashBytes([])).toBe(EMPTY_SHA256)
  })

  it('hashes "abc" to the known SHA-256 vector', () => {
    expect(hashBytes([new TextEncoder().encode('abc')])).toBe(ABC_SHA256)
  })

  it('matches the whole-file digest regardless of chunk boundaries', () => {
    const bytes = new TextEncoder().encode('The quick brown fox jumps over the lazy dog')
    expect(hashBytes([bytes])).toBe(FOX_SHA256)
    for (let split = 0; split <= bytes.length; split++) {
      expect(hashBytes([bytes.slice(0, split), bytes.slice(split)])).toBe(FOX_SHA256)
    }
    expect(hashBytes([bytes.slice(0, 10), bytes.slice(10, 20), bytes.slice(20)])).toBe(FOX_SHA256)
    expect(hashBytes([new Uint8Array(0), bytes, new Uint8Array(0)])).toBe(FOX_SHA256)
  })
})

describe('hashFile fail-open', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setWorkerConstructorForTests(null)
    terminate()
  })

  it('resolves null when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    const file = new File(['abc'], 'abc.txt', { type: 'text/plain' })
    await expect(hashFile(file)).resolves.toBeNull()
  })

  // A worker that accepts jobs but never answers: postMessage is a no-op and onmessage
  // never fires. Every hashFile call must still settle via the bounded timeout.
  class HangingWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    postMessage(): void {
      // never responds
    }
    terminate(): void {
      // no-op
    }
  }

  /** A worker the test drives manually: captures the job id, answers only on demand. */
  class ManualWorker {
    static last: ManualWorker | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    lastId: string | null = null
    constructor() {
      ManualWorker.last = this
    }
    postMessage(message: { id: string }): void {
      this.lastId = message.id
    }
    terminate(): void {
      // no-op
    }
    respond(checksum: string): void {
      this.onmessage?.({ data: { id: this.lastId, type: 'done', checksum } } as MessageEvent)
    }
  }

  it('resolves null when the worker never responds (bounded timeout)', async () => {
    setWorkerConstructorForTests(ManualWorker as unknown as new () => Worker)
    const file = new File(['abc'], 'abc.txt', { type: 'text/plain' })
    await expect(hashFile(file, undefined, 30)).resolves.toBeNull()
  })

  it('fails open every concurrent caller instead of deadlocking the queue', async () => {
    setWorkerConstructorForTests(HangingWorker as unknown as new () => Worker)
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt'), new File(['c'], 'c.txt')]
    // all three chain onto the single shared worker; each is bounded, so the second and third
    // settle after their own queue turn instead of hanging behind the stalled first call
    await expect(Promise.all(files.map((file) => hashFile(file, undefined, 30)))).resolves.toEqual([
      null,
      null,
      null,
    ])
  })

  it('ignores a late worker response after timing out', async () => {
    setWorkerConstructorForTests(ManualWorker as unknown as new () => Worker)
    const file = new File(['abc'], 'abc.txt', { type: 'text/plain' })
    await expect(hashFile(file, undefined, 30)).resolves.toBeNull()
    // the stalled job answers after its caller already failed open: the orphaned pending
    // entry is gone, so this must be a no-op rather than a leak or a cross-call resolve
    ManualWorker.last?.respond('late-checksum')
    const next = hashFile(new File(['def'], 'def.txt', { type: 'text/plain' }), undefined, 5000)
    setTimeout(() => ManualWorker.last?.respond(ABC_SHA256), 10)
    await expect(next).resolves.toBe(ABC_SHA256)
  })
})
