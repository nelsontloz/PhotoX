import * as http from 'node:http'
import { Test } from '@nestjs/testing'
import type { INestApplicationContext } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { SERVICE_URLS } from '@photox/shared-config'
import { AppModule } from '../../src/app.module'
import { BullMqService } from '../../src/queue/bullmq.service'
import { FaceDetectorService } from '../../src/queue/face.detector'
import { setupTestInfra, teardownTestInfra } from './test-setup'

export interface StubCall {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: Buffer
}

type ResponseFn = (call: StubCall, res: http.ServerResponse) => void

interface StubRoute {
  method: string
  match: (url: string) => boolean
  handler: ResponseFn
}

export interface StubServer {
  server: http.Server
  port: number
  calls: StubCall[]
  setResponse(method: string, pattern: string | RegExp, handler: ResponseFn): void
  clearRoutes(): void
  resetCalls(): void
  stop(): Promise<void>
}

function collectBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

export function startStubServer(): Promise<StubServer> {
  const calls: StubCall[] = []
  const routes: StubRoute[] = []

  const server = http.createServer((req, res) => {
    void (async () => {
      const body = await collectBody(req)
      const call: StubCall = {
        method: req.method!,
        url: req.url!,
        headers: req.headers,
        body,
      }
      calls.push(call)

      for (let i = routes.length - 1; i >= 0; i--) {
        const route = routes[i]!
        if (route.method === call.method && route.match(call.url)) {
          route.handler(call, res)
          return
        }
      }

      res.writeHead(404)
      res.end('Not Found')
    })()
  })

  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        server,
        port,
        calls,
        setResponse(method, pattern, handler) {
          const match =
            typeof pattern === 'string'
              ? (url: string) => url.split('?')[0] === pattern
              : (url: string) => pattern.test(url)
          routes.push({ method, match, handler })
        },
        clearRoutes() {
          routes.length = 0
        },
        resetCalls() {
          calls.length = 0
        },
        stop() {
          return new Promise<void>((r) => server.close(() => r()))
        },
      })
    })
  })
}

export interface TestApp {
  app: INestApplicationContext
  stub: StubServer
  getQueue(name: string): Queue
}

export async function createTestApp(): Promise<TestApp> {
  await setupTestInfra()
  const stub = await startStubServer()

  const port = stub.port
  Object.assign(SERVICE_URLS, {
    'media-service': `http://localhost:${port}`,
    'file-storage-service': `http://localhost:${port}`,
  })

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(FaceDetectorService)
    .useValue({ detect: vi.fn().mockResolvedValue([]) })
    .compile()

  const app = await moduleRef.init()
  const bullMq = app.get(BullMqService)

  return {
    app,
    stub,
    getQueue: (name: string) => bullMq.getQueue(name),
  }
}

export async function closeTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close()
  await testApp.stub.stop()
  await teardownTestInfra()
}

export async function waitForJob(
  queue: Queue,
  jobId: string,
  timeoutMs = 30_000,
): Promise<'completed' | 'failed'> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const job = await queue.getJob(jobId)
    if (job) {
      const state = await job.getState()
      if (state === 'completed' || state === 'failed') return state
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Job ${jobId} did not finish in ${timeoutMs}ms`)
}
