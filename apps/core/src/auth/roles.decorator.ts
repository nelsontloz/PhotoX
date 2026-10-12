import { SetMetadata } from '@nestjs/common'
import type { Role } from '@photox/shared-types'

// method- or controller-level required roles, enforced by RolesGuard (runs after JwtAuthGuard)
export const ROLES_KEY = 'roles'
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)
