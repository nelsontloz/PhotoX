import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator'
import type { CreateAlbumDto as ICreateAlbumDto } from '@photox/shared-types'

export class CreateAlbumDto implements ICreateAlbumDto {
  @ApiProperty({ example: 'Summer 2024' })
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
