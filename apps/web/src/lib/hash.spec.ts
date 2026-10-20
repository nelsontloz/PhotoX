import { describe, it, expect, vi, afterEach } from 'vitest'
import { hashFile, setWorkerConstructorForTests, terminate } from './hash'

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

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
