import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { BadRequestException } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { UserFilesService } from './user-files.service'
import { FileRecord } from '../../entities/file-record.entity'
import { MinioService } from '../../storage/minio.service'

type MockFn = ReturnType<typeof vi.fn>

describe('UserFilesService', () => {
  let service: UserFilesService
  let fileRepo: { findOne: MockFn; create: MockFn; save: MockFn }
  let minio: { uploadFile: MockFn; deleteFile: MockFn }
  let tempFiles: string[]

  beforeEach(async () => {
    fileRepo = { findOne: vi.fn(), create: vi.fn(), save: vi.fn() }
    minio = { uploadFile: vi.fn(), deleteFile: vi.fn() }
    tempFiles = []

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserFilesService,
        { provide: getRepositoryToken(FileRecord), useValue: fileRepo },
        { provide: MinioService, useValue: minio },
      ],
    }).compile()

    service = module.get(UserFilesService)
  })

  afterEach(async () => {
    for (const p of tempFiles) {
      if (existsSync(p)) await unlink(p)
    }
  })

  async function makeTempFile(
    content: Buffer | string,
  ): Promise<{ path: string; content: Buffer }> {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const path = join(tmpdir(), `photox-test-${randomUUID()}`)
    await writeFile(path, buf)
    tempFiles.push(path)
    return { path, content: buf }
  }

  function mockSavePath() {
    fileRepo.findOne.mockResolvedValue(null)
    fileRepo.create.mockImplementation((data: Partial<FileRecord>) => ({ ...data, id: 'rec-1' }))
    fileRepo.save.mockImplementation((rec: FileRecord) => Promise.resolve(rec))
  }

  it('streams the temp file and computes the same sha256 as hashing the content directly', async () => {
    const { path, content } = await makeTempFile('hello world')
    mockSavePath()

    const result = await service.upload('user-1', {
      path,
      originalname: 'hello.txt',
      mimetype: 'text/plain',
      size: content.length,
    })

    expect(result.checksumSha256).toBe(createHash('sha256').update(content).digest('hex'))
    expect(existsSync(path)).toBe(false)
  })

  it('returns the existing record on checksum match without uploading', async () => {
    const { path, content } = await makeTempFile('duplicate content')
    const existing = { id: 'existing-1' } as FileRecord
    fileRepo.findOne.mockResolvedValue(existing)

    const result = await service.upload('user-1', {
      path,
      originalname: 'dup.txt',
      mimetype: 'text/plain',
      size: content.length,
    })

    expect(result).toBe(existing)
    expect(minio.uploadFile).not.toHaveBeenCalled()
    expect(existsSync(path)).toBe(false)
  })

  it('uploads the file stream with the correct size and content type', async () => {
    const { path, content } = await makeTempFile(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))
    mockSavePath()
    const chunks: Buffer[] = []
    let capturedKey = ''
    let capturedSize = 0
    let capturedContentType = ''
    minio.uploadFile.mockImplementation(
      (key: string, stream: Readable, size: number, contentType: string) => {
        capturedKey = key
        capturedSize = size
        capturedContentType = contentType
        return (async () => {
          for await (const chunk of stream) chunks.push(chunk as Buffer)
        })()
      },
    )

    await service.upload('user-1', {
      path,
      originalname: 'data.bin',
      mimetype: 'application/octet-stream',
      size: content.length,
    })

    expect(minio.uploadFile).toHaveBeenCalledTimes(1)
    expect(Buffer.concat(chunks)).toEqual(content)
    expect(capturedKey).toContain('user-1/')
    expect(capturedSize).toBe(content.length)
    expect(capturedContentType).toBe('application/octet-stream')
  })

  it('unlinks the temp file when MinIO upload fails', async () => {
    const { path, content } = await makeTempFile('minio is down')
    fileRepo.findOne.mockResolvedValue(null)
    minio.uploadFile.mockRejectedValue(new Error('MinIO connection failed'))

    await expect(
      service.upload('user-1', {
        path,
        originalname: 'fail.bin',
        mimetype: 'application/octet-stream',
        size: content.length,
      }),
    ).rejects.toThrow(BadRequestException)

    expect(existsSync(path)).toBe(false)
  })

  it('deletes the MinIO object and unlinks the temp file when the DB save fails', async () => {
    const { path, content } = await makeTempFile('db is down')
    fileRepo.findOne.mockResolvedValue(null)
    fileRepo.create.mockImplementation((data: Partial<FileRecord>) => ({ ...data, id: 'rec-1' }))
    fileRepo.save.mockRejectedValue(new Error('db unavailable'))
    minio.uploadFile.mockResolvedValue(undefined)
    minio.deleteFile.mockResolvedValue(undefined)

    await expect(
      service.upload('user-1', {
        path,
        originalname: 'db.bin',
        mimetype: 'application/octet-stream',
        size: content.length,
      }),
    ).rejects.toThrow(BadRequestException)

    expect(minio.deleteFile).toHaveBeenCalled()
    expect(existsSync(path)).toBe(false)
  })

  it('registers derivatives with transcode purpose and assetId', async () => {
    const { path, content } = await makeTempFile('transcoded video')
    fileRepo.findOne.mockResolvedValue(null)
    fileRepo.create.mockImplementation((data: Partial<FileRecord>) => ({ ...data, id: 'rec-2' }))
    fileRepo.save.mockImplementation((rec: FileRecord) => Promise.resolve(rec))
    minio.uploadFile.mockResolvedValue(undefined)

    const result = await service.uploadDerivative('user-1', 'asset-9', {
      path,
      originalname: 'out.webm',
      mimetype: 'video/webm',
      size: content.length,
    })

    expect(result.purpose).toBe('transcode')
    expect(result.assetId).toBe('asset-9')
    expect(fileRepo.findOne.mock.calls[0]![0]).toMatchObject({
      where: { assetId: 'asset-9', purpose: 'transcode' },
    })
  })
})
