import { Test, type TestingModule } from '@nestjs/testing'
import type { Request, Response } from 'express'
import { UserFilesController } from './user-files.controller'
import { UserFilesService } from './user-files.service'

describe('UserFilesController – Range streaming', () => {
  let controller: UserFilesController
  let service: {
    stream: ReturnType<typeof vi.fn>
    upload: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    getOne: ReturnType<typeof vi.fn>
    download: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    getBatch: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    service = {
      stream: vi.fn(),
      upload: vi.fn(),
      list: vi.fn(),
      getOne: vi.fn(),
      download: vi.fn(),
      delete: vi.fn(),
      getBatch: vi.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserFilesController],
      providers: [{ provide: UserFilesService, useValue: service }],
    }).compile()

    controller = module.get(UserFilesController)
  })

  function mockRes() {
    const headers: Record<string, string> = {}
    let statusCode = 200
    const res = {
      set: vi.fn((h: Record<string, string>) => {
        Object.assign(headers, h)
      }),
      status: vi.fn((code: number) => {
        statusCode = code
        return res
      }),
      end: vi.fn(),
      on: vi.fn(),
      write: vi.fn(),
      pipe: vi.fn(),
    } as unknown as Response
    return {
      res,
      headers,
      getStatus: () => statusCode,
    }
  }

  function mockReq(headers: Record<string, string | undefined> = {}): Request {
    return { headers } as unknown as Request
  }

  it('returns 200 with full body when no Range header', async () => {
    service.stream.mockResolvedValue({
      stream: { pipe: vi.fn() },
      record: { mimeType: 'video/mp4', originalName: 'test.mp4' },
      totalSize: 1000,
    })

    const { res, headers } = mockRes()
    const req = mockReq()

    await controller.stream('file-1', res, req)

    expect(headers['Accept-Ranges']).toBe('bytes')
    expect(headers['Content-Type']).toBe('video/mp4')
  })

  it('returns 206 with Content-Range when Range header present', async () => {
    service.stream
      .mockResolvedValueOnce({
        stream: { pipe: vi.fn() },
        record: { mimeType: 'video/mp4', originalName: 'test.mp4' },
        totalSize: 1000,
      })
      .mockResolvedValueOnce({
        stream: { pipe: vi.fn() },
        record: { mimeType: 'video/mp4', originalName: 'test.mp4' },
        totalSize: 1000,
      })

    const { res, headers, getStatus } = mockRes()
    const req = mockReq({ range: 'bytes=0-4' })

    await controller.stream('file-1', res, req)

    expect(getStatus()).toBe(206)
    expect(headers['Content-Range']).toBe('bytes 0-4/1000')
    expect(headers['Content-Length']).toBe('5')
    expect(headers['Accept-Ranges']).toBe('bytes')
  })

  it('returns 206 with open-ended Range', async () => {
    service.stream
      .mockResolvedValueOnce({
        stream: { pipe: vi.fn() },
        record: { mimeType: 'video/mp4', originalName: 'test.mp4' },
        totalSize: 1000,
      })
      .mockResolvedValueOnce({
        stream: { pipe: vi.fn() },
        record: { mimeType: 'video/mp4', originalName: 'test.mp4' },
        totalSize: 1000,
      })

    const { res, headers, getStatus } = mockRes()
    const req = mockReq({ range: 'bytes=997-' })

    await controller.stream('file-1', res, req)

    expect(getStatus()).toBe(206)
    expect(headers['Content-Range']).toBe('bytes 997-999/1000')
    expect(headers['Content-Length']).toBe('3')
  })

  it('returns 416 for out-of-range start', async () => {
    service.stream.mockResolvedValue({
      stream: { pipe: vi.fn() },
      record: { mimeType: 'video/mp4', originalName: 'test.mp4' },
      totalSize: 100,
    })

    const { res, getStatus } = mockRes()
    const req = mockReq({ range: 'bytes=200-300' })

    await controller.stream('file-1', res, req)

    expect(getStatus()).toBe(416)
    expect((res as unknown as { end: ReturnType<typeof vi.fn> }).end).toHaveBeenCalled()
  })

  it('returns 416 for invalid Range format', async () => {
    service.stream.mockResolvedValue({
      stream: { pipe: vi.fn() },
      record: { mimeType: 'video/mp4', originalName: 'test.mp4' },
      totalSize: 100,
    })

    const { res, getStatus } = mockRes()
    const req = mockReq({ range: 'invalid' })

    await controller.stream('file-1', res, req)

    expect(getStatus()).toBe(416)
    expect((res as unknown as { end: ReturnType<typeof vi.fn> }).end).toHaveBeenCalled()
  })

  it('clamps end byte to totalSize-1 when Range exceeds total', async () => {
    service.stream
      .mockResolvedValueOnce({
        stream: { pipe: vi.fn() },
        record: { mimeType: 'video/mp4', originalName: 'test.mp4' },
        totalSize: 100,
      })
      .mockResolvedValueOnce({
        stream: { pipe: vi.fn() },
        record: { mimeType: 'video/mp4', originalName: 'test.mp4' },
        totalSize: 100,
      })

    const { res, headers, getStatus } = mockRes()
    const req = mockReq({ range: 'bytes=90-200' })

    await controller.stream('file-1', res, req)

    expect(getStatus()).toBe(206)
    expect(headers['Content-Range']).toBe('bytes 90-99/100')
    expect(headers['Content-Length']).toBe('10')
  })
})
