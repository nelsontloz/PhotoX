import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString } from 'class-validator'
import type { RefreshRequest } from '@photox/shared-types'

export class RefreshDto implements RefreshRequest {
  @ApiProperty({
    description:
      'The opaque refresh token from the last auth response; omit when the HttpOnly refresh cookie carries it',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string
}
