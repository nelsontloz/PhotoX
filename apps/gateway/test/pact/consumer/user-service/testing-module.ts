import type { INestApplication } from '@nestjs/common'
import { ValidationPipe, type ExecutionContext } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { AuthProxyController } from '../../../../src/proxy/auth-proxy/auth-proxy.controller'
import { requestIdMiddleware } from '../../../../src/common/middleware/request-id.middleware'
import { ProxyService } from '../../../../src/proxy/proxy.service'
import { createStubProxy } from '../stub'
import type { StubProxy } from '../stub'

export async function setupUserServicePactModule(): Promise<{
  app: INestApplication
  stub: StubProxy
}> {
  process.env.AUTH_TOKEN_SECRET = 'test-secret-that-is-at-least-32-characters-long!!'
  process.env.AUTH_CLOCK_TOLERANCE_SEC = '60'

  const stub = createStubProxy()

  const module = await Test.createTestingModule({
    controllers: [AuthProxyController],
    providers: [
      { provide: ProxyService, useValue: stub },
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
  await app.init()

  return { app, stub }
}
