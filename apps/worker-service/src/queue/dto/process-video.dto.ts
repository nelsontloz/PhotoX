import { IsString, IsNotEmpty, IsUUID } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class ProcessVideoDto {
  @ApiProperty({ description: 'Asset UUID' })
  @IsString()
  @IsNotEmpty()
  assetId!: string

  @ApiProperty({ description: 'Original file UUID in file-storage' })
  @IsString()
  @IsNotEmpty()
  fileId!: string

  @ApiProperty({ description: 'Owner user UUID' })
  @IsUUID()
  @IsNotEmpty()
  userId!: string
}
