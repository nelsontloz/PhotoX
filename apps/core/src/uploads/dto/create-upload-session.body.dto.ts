import { ApiProperty } from '@nestjs/swagger'
import { IsDateString, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { TitleDescriptionDto } from '../../common/title-description.dto'

// POST /api/v1/uploads body. `sizeBytes` deliberately has no @Min/@Max here: an out-of-range
// size is a 413 SIZE_LIMIT from the service (documented contract), not a ValidationPipe 400.
export class CreateUploadSessionBodyDto extends TitleDescriptionDto {
  @ApiProperty({ example: 104857600, description: 'total file size, 1 .. 4 GiB' })
  @IsInt()
  sizeBytes!: number

  @ApiProperty({ example: 'IMG_0001.HEIC', description: 'display only — never a path' })
  @IsString()
  @MaxLength(255)
  originalName!: string

  @ApiProperty({ required: false, description: 'sha256 of the whole file, verified at complete' })
  @IsOptional()
  @Matches(/^[0-9a-fA-F]{64}$/)
  checksumSha256?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  takenAt?: string
}
