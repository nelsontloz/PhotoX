import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator'
import type { FileExistsCheckItem } from '@photox/shared-types'

export class CheckFilesExistsItemDto implements FileExistsCheckItem {
  @Matches(/^[0-9a-f]{64}$/)
  @ApiProperty()
  checksumSha256!: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiProperty({ required: false })
  sizeBytes?: number
}

export class CheckFilesExistsBodyDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CheckFilesExistsItemDto)
  @ApiProperty({ type: [CheckFilesExistsItemDto] })
  items!: CheckFilesExistsItemDto[]
}
