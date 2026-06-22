import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { JwtAuthGuard } from './jwt-auth.guard'

function createMockRequest(path: string) {
  return { path } as Request
}

function createMockContext(path: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => createMockRequest(path),
      getResponse: () => ({}),
    }),
    getHandler: () => () => undefined,
    getClass: () => class A {},
  } as unknown as ExecutionContext
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard
  let reflector: Reflector

  beforeEach(() => {
    reflector = new Reflector()
    guard = new JwtAuthGuard(reflector)
  })

  describe('/docs skip', () => {
    it('G-1: skips JWT for /docs', () => {
      expect(guard.canActivate(createMockContext('/docs'))).toBe(true)
    })

    it('G-2: skips JWT for /docs-json', () => {
      expect(guard.canActivate(createMockContext('/docs-json'))).toBe(true)
    })

    it('G-3: skips JWT for /docs/* static assets', () => {
      expect(guard.canActivate(createMockContext('/docs/swagger-ui-init.js'))).toBe(true)
    })
  })

  describe('@Public() decorator interaction', () => {
    it('G-4: skips JWT when @Public() is set on non-docs path', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true)
      expect(guard.canActivate(createMockContext('/api/v1/auth/login'))).toBe(true)
    })

    it('G-5: /docs path short-circuits before @Public() check', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      expect(guard.canActivate(createMockContext('/docs'))).toBe(true)
    })
  })

  describe('super.canActivate fallthrough', () => {
    it('G-6: non-docs, non-public path rejects (no Passport strategy registered)', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      await expect(guard.canActivate(createMockContext('/api/v1/auth/login'))).rejects.toThrow()
    })
  })
})
