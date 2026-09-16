import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import type { Role } from '@photox/shared-types'

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const user = request.user as { id: string; email: string; role: Role } | undefined
    if (user?.role !== 'admin') {
      throw new ForbiddenException('Admin only')
    }
    return true
  }
}
