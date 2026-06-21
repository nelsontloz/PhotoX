import { Injectable, HttpException, BadGatewayException, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom, timeout, catchError, throwError } from 'rxjs'
import type { AxiosError } from 'axios'
import type { Readable } from 'stream'
import type { Request } from 'express'
import * as http from 'http'
import FormData from 'form-data'

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
        userId: opts.headers?.['x-user-id'],
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

  async forwardStream(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; headers: Record<string, string>; data: Readable }> {
    const start = Date.now()

    const response = await firstValueFrom(
      this.http
        .request<Readable>({
          method: 'GET',
          url,
          responseType: 'stream',
          headers,
          timeout: 30_000,
          validateStatus: () => true,
        })
        .pipe(
          timeout(30_000),
          catchError((err: AxiosError) => throwError(() => err)),
        ),
    )

    const latencyMs = Date.now() - start
    this.logger.log({
      method: 'GET',
      path: url,
      upstreamStatus: response.status,
      latencyMs,
      requestId: headers['x-request-id'],
    })

    const upstreamHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(response.headers)) {
      if (value && typeof value === 'string') {
        upstreamHeaders[key] = value
      }
    }

    return { status: response.status, headers: upstreamHeaders, data: response.data }
  }

  async forwardRawBody<T = unknown>(
    targetUrl: string,
    req: Request,
    headers: Record<string, string>,
  ): Promise<{ status: number; data: T }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl)

      const upstreamHeaders: Record<string, string> = { ...headers }
      const incomingHeader = req.headers['content-type']
      if (incomingHeader) {
        upstreamHeaders['content-type'] = Array.isArray(incomingHeader)
          ? String(incomingHeader[0])
          : String(incomingHeader)
      }

      const upstreamReq = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: 'POST',
          headers: upstreamHeaders,
          timeout: 60_000,
        },
        (upstreamRes) => {
          const chunks: Buffer[] = []
          upstreamRes.on('data', (c: Buffer) => chunks.push(c))
          upstreamRes.on('end', () => {
            const buf = Buffer.concat(chunks)
            let data: T
            try {
              data = JSON.parse(buf.toString('utf8')) as T
            } catch {
              data = buf as unknown as T
            }

            const status = upstreamRes.statusCode ?? 500
            this.logger.log({
              method: 'POST',
              path: parsed.pathname,
              service: targetUrl,
              upstreamStatus: status,
              latencyMs: 0,
              requestId: headers['x-request-id'],
            })

            if (status >= 400 && status < 500) {
              return reject(new HttpException(data as string | Record<string, unknown>, status))
            }
            if (status >= 500) {
              return reject(
                new BadGatewayException({
                  statusCode: 502,
                  upstream: targetUrl,
                  message: 'Upstream server error',
                  traceId: headers['x-request-id'],
                }),
              )
            }

            resolve({ status, data })
          })
        },
      )

      upstreamReq.on('error', (err) => {
        this.logger.warn({
          method: 'POST',
          path: parsed.pathname,
          service: targetUrl,
          error: err.message,
          requestId: headers['x-request-id'],
        })
        reject(
          new BadGatewayException({
            statusCode: 502,
            upstream: targetUrl,
            message: `Upstream unavailable: ${err.message}`,
            traceId: headers['x-request-id'],
          }),
        )
      })

      upstreamReq.on('timeout', () => {
        upstreamReq.destroy()
        reject(
          new BadGatewayException({
            statusCode: 502,
            upstream: targetUrl,
            message: 'Upstream timeout',
            traceId: headers['x-request-id'],
          }),
        )
      })

      req.pipe(upstreamReq)
    })
  }

  async forwardFormData<T = unknown>(
    targetUrl: string,
    form: FormData,
    extraHeaders: Record<string, string>,
  ): Promise<{ status: number; data: T }> {
    const parsed = new URL(targetUrl)
    const formHeaders = form.getHeaders()

    return new Promise((resolve, reject) => {
      const upstreamReq = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: 'POST',
          headers: { ...extraHeaders, ...formHeaders },
          timeout: 60_000,
        },
        (upstreamRes) => {
          const chunks: Buffer[] = []
          upstreamRes.on('data', (c: Buffer) => chunks.push(c))
          upstreamRes.on('end', () => {
            const buf = Buffer.concat(chunks)
            let data: T
            try {
              data = JSON.parse(buf.toString('utf8')) as T
            } catch {
              data = buf as unknown as T
            }

            const status = upstreamRes.statusCode ?? 500
            this.logger.log({
              method: 'POST',
              path: parsed.pathname,
              service: targetUrl,
              upstreamStatus: status,
              latencyMs: 0,
              requestId: extraHeaders['x-request-id'],
            })

            if (status >= 400 && status < 500) {
              return reject(new HttpException(data as string | Record<string, unknown>, status))
            }
            if (status >= 500) {
              return reject(
                new BadGatewayException({
                  statusCode: 502,
                  upstream: targetUrl,
                  message: 'Upstream server error',
                  traceId: extraHeaders['x-request-id'],
                }),
              )
            }

            resolve({ status, data })
          })
        },
      )

      upstreamReq.on('error', (err) => {
        this.logger.warn({
          method: 'POST',
          path: parsed.pathname,
          service: targetUrl,
          error: err.message,
          requestId: extraHeaders['x-request-id'],
        })
        reject(
          new BadGatewayException({
            statusCode: 502,
            upstream: targetUrl,
            message: `Upstream unavailable: ${err.message}`,
            traceId: extraHeaders['x-request-id'],
          }),
        )
      })

      upstreamReq.on('timeout', () => {
        upstreamReq.destroy()
        reject(
          new BadGatewayException({
            statusCode: 502,
            upstream: targetUrl,
            message: 'Upstream timeout',
            traceId: extraHeaders['x-request-id'],
          }),
        )
      })

      form.pipe(upstreamReq)
    })
  }
}
