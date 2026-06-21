import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

export interface CurrentUser {
  id: string
  email: string
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUser => {
    const request = ctx.switchToHttp().getRequest<Request>()
    const user = request.user as { id: string; email: string } | undefined
    return { id: user?.id ?? '', email: user?.email ?? '' }
  },
)
