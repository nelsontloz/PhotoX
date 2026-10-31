import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { S3BackupService } from './s3-backup.service'

type Send = (command: unknown) => Promise<unknown>

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 's3-backup-spec-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A GetObject body; `fail` enqueues bytes then errors, like a transfer dropped mid-stream. */
function bodyOf(text: string, fail = false): { transformToWebStream: () => ReadableStream } {
  const bytes = new TextEncoder().encode(text)
  return {
    transformToWebStream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          if (fail) controller.error(new Error('response body dropped'))
          else controller.close()
        },
      }),
  }
}

function makeService(send: Send): S3BackupService {
  const service = new S3BackupService()
  ;(service as unknown as { client: { send: Send } }).client = { send }
  return service
}

describe('S3BackupService.downloadToFile restart', () => {
  it('restarts the whole GET once after a dropped body and leaves no partial file', async () => {
    let calls = 0
    const send: Send = vi.fn(() => {
      calls += 1
      return Promise.resolve({
        Body: bodyOf(calls === 1 ? 'partial' : 'whole object', calls === 1),
      })
    })
    const dest = join(dir, 'out.bin')

    await makeService(send).downloadToFile('backups/a.bin', dest)

    expect(calls).toBe(2)
    await expect(readFile(dest, 'utf8')).resolves.toBe('whole object')
    expect(await readdir(dir)).toEqual(['out.bin'])
  })

  it('rejects with the last error and leaves nothing behind after two failures', async () => {
    const send: Send = vi.fn(() => Promise.resolve({ Body: bodyOf('partial', true) }))
    const dest = join(dir, 'out.bin')

    await expect(makeService(send).downloadToFile('backups/a.bin', dest)).rejects.toThrow(
      'response body dropped',
    )
    expect(send).toHaveBeenCalledTimes(2)
    await expect(stat(dest)).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })

  it('does not restart a missing key', async () => {
    const missing = Object.assign(new Error('not found'), { name: 'NoSuchKey' })
    const send: Send = vi.fn(() => Promise.reject(missing))

    await expect(
      makeService(send).downloadToFile('backups/gone.bin', join(dir, 'out.bin')),
    ).rejects.toBe(missing)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
