import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsNotEmpty } from 'class-validator'
import type { RefreshRequest } from '@photox/shared-types'

export class RefreshDto implements RefreshRequest {
  @ApiProperty({ description: 'The opaque refresh token from the last auth response' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string
}
