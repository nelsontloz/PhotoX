import { describe, it, expect, vi, beforeEach } from 'vitest'
import { of } from 'rxjs'
import { once } from 'events'
import { PassThrough, Readable } from 'stream'
import { BadGatewayException } from '@nestjs/common'
import type { HttpService } from '@nestjs/axios'
import type { Request, Response } from 'express'
import { FilesProxyController } from './files-proxy.controller'
import type { ProxyService } from '../proxy.service'
import type { BullMqService } from '../../queue/bullmq.service'

function mockHttp() {
  return { get: vi.fn() }
}

function upstreamResponse(
  status: number,
  statusText: string,
  headers: Record<string, string>,
  data: unknown,
) {
  return { status, statusText, headers, data }
}

describe('FilesProxyController.download', () => {
  let http: ReturnType<typeof mockHttp>
  let controller: FilesProxyController

  beforeEach(() => {
    http = mockHttp()
    controller = new FilesProxyController(
      {} as ProxyService,
      http as unknown as HttpService,
      {} as BullMqService,
    )
  })

  function callDownload(res: unknown) {
    return controller.download(
      'file-1',
      { user: { id: 'user-1' }, headers: {} } as unknown as Request,
      res as Response,
    )
  }

  it('pipes the upstream stream to the response and forwards content headers', async () => {
    const data = Readable.from(['hello'])
    http.get.mockReturnValue(
      of(
        upstreamResponse(
          200,
          'OK',
          {
            'content-type': 'image/jpeg',
            'content-length': '5',
            'content-disposition': 'attachment; filename="a.jpg"',
          },
          data,
        ),
      ),
    )

    const res = new PassThrough()
    const setSpy = vi.fn().mockReturnValue(res)
    const statusSpy = vi.fn().mockReturnValue(res)
    const jsonSpy = vi.fn()
    ;(res as unknown as Record<string, unknown>).set = setSpy
    ;(res as unknown as Record<string, unknown>).status = statusSpy
    ;(res as unknown as Record<string, unknown>).json = jsonSpy
    const writeSpy = vi.spyOn(res, 'write')

    const downloadPromise = callDownload(res)
    await once(data, 'end')
    await downloadPromise

    expect(http.get).toHaveBeenCalledWith(
      expect.stringContaining('/download'),
      expect.objectContaining({ responseType: 'stream', timeout: 300_000 }),
    )
    expect(setSpy).toHaveBeenCalledWith({
      'Content-Type': 'image/jpeg',
      'Content-Length': '5',
      'Content-Disposition': 'attachment; filename="a.jpg"',
    })
    expect(writeSpy).toHaveBeenCalledWith('hello')
    expect(res.writableEnded).toBe(true)
  })

  it('passes upstream 4xx status through with the upstream status message', async () => {
    http.get.mockReturnValue(
      of(upstreamResponse(416, 'Requested Range Not Satisfiable', {}, new Readable())),
    )
    const res = { status: vi.fn(), json: vi.fn() }
    res.status.mockReturnValue(res)

    await callDownload(res)

    expect(res.status).toHaveBeenCalledWith(416)
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 416,
      message: 'Requested Range Not Satisfiable',
    })
  })

  it('maps upstream 5xx to 502 BadGateway and destroys the upstream stream', async () => {
    const data = new Readable()
    http.get.mockReturnValue(of(upstreamResponse(500, 'Internal Server Error', {}, data)))
    const res = { status: vi.fn(), json: vi.fn() }

    await expect(callDownload(res)).rejects.toBeInstanceOf(BadGatewayException)
    expect(data.destroyed).toBe(true)
  })
})
