import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsNotEmpty } from 'class-validator'
import type { LogoutRequest } from '@photox/shared-types'

export class LogoutDto implements LogoutRequest {
  @ApiProperty({ description: 'The refresh token to revoke (idempotent)' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string
}
