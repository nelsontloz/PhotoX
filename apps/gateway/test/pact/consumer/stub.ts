import axios from 'axios'
import { HttpException, BadGatewayException } from '@nestjs/common'

interface ForwardOpts {
  method: string
  path: string
  body?: unknown
  headers?: Record<string, string>
  query?: Record<string, string>
  timeout?: number
}

export interface StubProxy {
  targetUrl: string
  targetUrls: Record<string, string>
  calls: ForwardOpts[]
  interceptFn?: (serviceUrl: string, opts: ForwardOpts) => { status: number; data: unknown } | null
  forward<T = unknown>(serviceUrl: string, opts: ForwardOpts): Promise<{ status: number; data: T }>
}

export function createStubProxy(): StubProxy {
  const stub: StubProxy = {
    targetUrl: '',
    targetUrls: {},
    calls: [],
    interceptFn: undefined,
    forward: async <T = unknown>(serviceUrl: string, opts: ForwardOpts) => {
      stub.calls.push(opts)
      if (stub.interceptFn) {
        const intercepted = stub.interceptFn(serviceUrl, opts)
        if (intercepted) {
          if (intercepted.status >= 400 && intercepted.status < 500) {
            throw new HttpException(
              intercepted.data as string | Record<string, unknown>,
              intercepted.status,
            )
          }
          if (intercepted.status >= 500) {
            throw new BadGatewayException({
              statusCode: 502,
              upstream: serviceUrl,
              message: 'Upstream server error',
              traceId: opts.headers?.['x-request-id'],
            })
          }
          return { status: intercepted.status, data: intercepted.data as T }
        }
      }
      const url = `${stub.targetUrls[serviceUrl] ?? stub.targetUrl}/${opts.path}`
      const res = await axios.request<T>({
        method: opts.method,
        url,
        data: opts.body,
        params: opts.query,
        headers: opts.headers,
        validateStatus: () => true,
        timeout: opts.timeout,
      })
      return { status: res.status, data: res.data }
    },
  }
  return stub
}
