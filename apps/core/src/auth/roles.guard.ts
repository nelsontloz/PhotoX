import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Role } from '@photox/shared-types'
import { ROLES_KEY } from './roles.decorator'

// backup to JwtAuthGuard's inline admin check: enforces @Roles metadata after identity is set.
// No metadata → allow (open and plain-user routes stay untouched).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required?.length) return true
    const { user } = context.switchToHttp().getRequest<{ user?: { role: Role } }>()
    if (user && required.includes(user.role)) return true
    throw new ForbiddenException('Admin only')
  }
}
