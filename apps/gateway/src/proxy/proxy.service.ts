import { Injectable, HttpException, BadGatewayException, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom, timeout, catchError, throwError } from 'rxjs'
import type { AxiosError } from 'axios'

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'transfer-encoding',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
])

export interface ForwardOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  query?: Record<string, string>
  headers?: Record<string, string>
  timeout?: number
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name)

  constructor(private readonly http: HttpService) {}

  async forward<T = unknown>(
    serviceUrl: string,
    opts: ForwardOptions,
  ): Promise<{ status: number; data: T }> {
    const url = `${serviceUrl}/${opts.path}`
    const timeoutMs = opts.timeout ?? 5_000
    const start = Date.now()

    const headers: Record<string, string> = {}
    if (opts.headers) {
      for (const [key, value] of Object.entries(opts.headers)) {
        const lower = key.toLowerCase()
        if (!HOP_BY_HOP.has(lower)) {
          headers[key] = value
        }
      }
    }

    try {
      const response = await firstValueFrom(
        this.http
          .request<T>({
            method: opts.method,
            url,
            data: opts.body,
            params: opts.query,
            headers,
            timeout: timeoutMs,
            validateStatus: () => true,
          })
          .pipe(
            timeout(timeoutMs),
            catchError((err: AxiosError) => {
              return throwError(() => err)
            }),
          ),
      )

      const latencyMs = Date.now() - start
      this.logger.log({
        method: opts.method,
        path: opts.path,
        service: serviceUrl,
        upstreamStatus: response.status,
        latencyMs,
        requestId: opts.headers?.['x-request-id'],
      })

      if (response.status >= 400 && response.status < 500) {
        throw new HttpException(response.data as string | Record<string, unknown>, response.status)
      }

      if (response.status >= 500) {
        throw new BadGatewayException({
          statusCode: 502,
          upstream: serviceUrl,
          message: 'Upstream server error',
          traceId: opts.headers?.['x-request-id'],
        })
      }

      return { status: response.status, data: response.data }
    } catch (err: unknown) {
      const axiosErr = err as AxiosError & { code?: string }
      if (err instanceof HttpException) {
        throw err
      }

      if (
        axiosErr.code === 'ECONNREFUSED' ||
        axiosErr.code === 'ETIMEDOUT' ||
        axiosErr.code === 'ECONNABORTED'
      ) {
        this.logger.warn({
          method: opts.method,
          path: opts.path,
          service: serviceUrl,
          error: axiosErr.code,
          requestId: opts.headers?.['x-request-id'],
        })
        throw new BadGatewayException({
          statusCode: 502,
          upstream: serviceUrl,
          message: `Upstream unavailable: ${axiosErr.code}`,
          traceId: opts.headers?.['x-request-id'],
        })
      }

      throw err
    }
  }
}
