import { BadGatewayException, Injectable } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { loadEnv } from '@photox/shared-config'
import type { IdentityRequest } from '../auth/gateway-auth.guard'
import {
  buildProxyBody,
  buildProxyHeaders,
  buildTargetUrl,
  selectProxyTimeout,
  RESPONSE_HOP_HEADERS,
} from './proxy.utils'

@Injectable()
export class ProxyService {
  private readonly coreBaseUrl: string

  constructor() {
    this.coreBaseUrl = loadEnv().CORE_BASE_URL
  }

  async forward(req: Request, res: Response): Promise<void> {
    const user = (req as IdentityRequest).user
    const target = buildTargetUrl(this.coreBaseUrl, req.originalUrl)
    const headers = buildProxyHeaders(req.headers, user)
    const body = buildProxyBody(req)
    const timeout = selectProxyTimeout(req.method, req.headers['content-type'])

    let coreRes: globalThis.Response
    try {
      coreRes = await fetch(target, {
        method: req.method,
        headers,
        body: body as unknown as NonNullable<RequestInit['body']> | undefined,
        signal: AbortSignal.timeout(timeout),
        duplex: 'half',
      })
    } catch {
      throw new BadGatewayException('Core unreachable')
    }

    res.status(coreRes.status)
    coreRes.headers.forEach((value, key) => {
      if (key === 'set-cookie' || RESPONSE_HOP_HEADERS.has(key)) return
      res.setHeader(key, value)
    })
    for (const cookie of coreRes.headers.getSetCookie()) res.appendHeader('set-cookie', cookie)

    if (!coreRes.body) {
      res.end()
      return
    }
    const stream = Readable.fromWeb(coreRes.body)
    req.on('close', () => stream.destroy())
    try {
      await pipeline(stream, res)
    } catch {
      if (!res.headersSent) throw new BadGatewayException('Core unreachable')
      res.destroy()
    }
  }
}
