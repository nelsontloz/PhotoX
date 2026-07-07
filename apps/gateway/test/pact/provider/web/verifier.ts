/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import path from 'node:path'
import { type INestApplication, ValidationPipe, type ExecutionContext } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { AuthProxyController } from '../../../../src/proxy/auth-proxy/auth-proxy.controller'
import { AssetsProxyController } from '../../../../src/proxy/assets-proxy/assets-proxy.controller'
import { requestIdMiddleware } from '../../../../src/common/middleware/request-id.middleware'
import { ProxyService } from '../../../../src/proxy/proxy.service'
import { BullMqService } from '../../../../src/queue/bullmq.service'

export const PACT_DIR = path.resolve(__dirname, '../../../../../../pacts')

const authResponse = {
  accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.token',
  refreshToken: 'valid-refresh-token',
  user: {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    email: 'user@test.com',
    displayName: 'Test User',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
}

const asset = {
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  kind: 'photo',
  fileId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  uploadedAt: '2024-01-01T00:00:00.000Z',
  isTrashed: false,
  trashedAt: null,
  title: null,
  description: null,
  takenAt: null,
  favorite: false,
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  originalName: 'photo.jpg',
  width: 1920,
  height: 1080,
  durationSeconds: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  orientation: null,
  iso: null,
  fNumber: null,
  exposureTime: null,
  focalLength: null,
  latitude: null,
  longitude: null,
  altitude: null,
  fps: null,
  codec: null,
  hasAudio: null,
  metadata: null,
  metadataStatus: 'ready',
  metadataExtractedAt: null,
  transcodeStatus: 'ready',
  transcodeFileId: null,
  thumbnailStatus: 'ready',
  faceStatus: null,
  faceCount: null,
}

export async function setupMockedApp(): Promise<{
  app: INestApplication
  url: string
}> {
  process.env.AUTH_TOKEN_SECRET = 'test-secret-that-is-at-least-32-characters-long!!'
  process.env.AUTH_CLOCK_TOLERANCE_SEC = '60'

  const mockProxy = {
    forward: vi
      .fn()
      .mockImplementation((_serviceUrl: string, opts: { method: string; path: string }) => {
        if (opts.path === 'v1/auth/login')
          return Promise.resolve({ status: 200, data: authResponse })
        if (opts.path === 'v1/auth/register')
          return Promise.resolve({ status: 201, data: authResponse })
        if (opts.path === 'v1/auth/refresh')
          return Promise.resolve({ status: 200, data: authResponse })
        if (opts.path === 'v1/auth/logout') return Promise.resolve({ status: 204, data: undefined })
        if (opts.path === 'v1/assets' && opts.method === 'GET')
          return Promise.resolve({
            status: 200,
            data: { items: [asset], total: 1, limit: 20, offset: 0 },
          })
          if (/^v1\/assets\/[^/]+$/.exec(opts.path) && opts.method === 'GET')
          return Promise.resolve({ status: 200, data: asset })
        return Promise.resolve({ status: 200, data: {} })
      }),
  }

  const module = await Test.createTestingModule({
    controllers: [AuthProxyController, AssetsProxyController],
    providers: [
      { provide: ProxyService, useValue: mockProxy },
      {
        provide: BullMqService,
        useValue: {
          enqueue: vi.fn().mockResolvedValue(undefined),
          enqueueThumbnails: vi.fn(),
          enqueueVideo: vi.fn(),
        },
      },
      {
        provide: APP_GUARD,
        useValue: {
          canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest<{ user?: { id: string } }>()
            req.user = { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }
            return true
          },
        },
      },
    ],
  }).compile()

  const app = module.createNestApplication()
  app.use(requestIdMiddleware)
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  await app.listen(0)

  const url = await app.getUrl()

  return { app, url }
}
