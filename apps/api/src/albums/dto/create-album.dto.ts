import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsNotEmpty, MaxLength, IsOptional, IsUUID } from 'class-validator'
import type { CreateAlbumDto as ICreateAlbumDto } from '@photox/shared-types'

export class CreateAlbumDto implements ICreateAlbumDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  userId!: string

  @ApiProperty({ example: 'Summer 2026', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string
}
