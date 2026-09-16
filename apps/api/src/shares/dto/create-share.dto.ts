import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsUUID } from 'class-validator'
import type { CreateShareRequest } from '@photox/shared-types'

export class CreateShareDto implements CreateShareRequest {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsString()
  userId!: string

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('4')
  assetId!: string
}
