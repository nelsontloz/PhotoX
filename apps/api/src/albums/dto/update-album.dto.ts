import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength, IsUUID } from 'class-validator'
import type { UpdateAlbumDto as IUpdateAlbumDto } from '@photox/shared-types'

export class UpdateAlbumDto implements IUpdateAlbumDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  userId!: string

  @ApiProperty({ required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string
}
