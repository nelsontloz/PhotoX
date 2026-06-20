import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common'
import type { Request } from 'express'

@Injectable()
export class UserIdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const userId = request.headers['x-user-id']

    if (!userId || typeof userId !== 'string') {
      throw new BadRequestException('x-user-id header is required')
    }

    ;(request as Request & { userId: string }).userId = userId
    return true
  }
}
