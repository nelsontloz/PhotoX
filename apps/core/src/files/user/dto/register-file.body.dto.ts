import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator'

export class RegisterFileBodyDto {
  @IsUUID()
  @ApiProperty()
  id!: string

  @IsIn(['original', 'thumbnail', 'transcode'])
  @ApiProperty({ enum: ['original', 'thumbnail', 'transcode'] })
  kind!: 'original' | 'thumbnail' | 'transcode'

  @IsString()
  @Matches(/^[a-z0-9]{1,8}$/)
  @ApiProperty()
  ext!: string

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  @ApiProperty()
  checksumSha256!: string

  @IsString()
  @ApiProperty()
  originalName!: string

  @IsString()
  @ApiProperty()
  mimeType!: string

  @IsInt()
  @Min(0)
  @ApiProperty()
  sizeBytes!: number

  @IsOptional()
  @IsUUID()
  @ApiProperty({ required: false })
  assetId?: string
}
