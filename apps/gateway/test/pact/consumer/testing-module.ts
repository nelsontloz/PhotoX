/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import axios from 'axios'
import { AuthProxyController } from '../../../src/proxy/auth-proxy/auth-proxy.controller'
import { requestIdMiddleware } from '../../../src/common/middleware/request-id.middleware'
import { ProxyService } from '../../../src/proxy/proxy.service'

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
  calls: ForwardOpts[]
  forward<T = unknown>(serviceUrl: string, opts: ForwardOpts): Promise<{ status: number; data: T }>
}

function createStubProxy(): StubProxy {
  const stub: StubProxy = {
    targetUrl: '',
    calls: [],
    forward: async <T = unknown>(_serviceUrl: string, opts: ForwardOpts) => {
      stub.calls.push(opts)
      const url = `${stub.targetUrl}/${opts.path}`
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

export async function setupGatewayTestingModule(): Promise<{
  app: INestApplication
  stub: StubProxy
}> {
  process.env.AUTH_TOKEN_SECRET = 'test-secret-that-is-at-least-32-characters-long!!'
  process.env.AUTH_CLOCK_TOLERANCE_SEC = '60'

  const stub = createStubProxy()

  const module = await Test.createTestingModule({
    controllers: [AuthProxyController],
    providers: [{ provide: ProxyService, useValue: stub }],
  }).compile()

  const app = module.createNestApplication()
  app.use(requestIdMiddleware)
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  await app.init()

  return { app, stub }
}
