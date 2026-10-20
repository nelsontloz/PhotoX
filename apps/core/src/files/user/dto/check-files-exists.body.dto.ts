import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, Matches, ValidateNested } from 'class-validator'
import type { FileExistsCheckItem } from '@photox/shared-types'

export class CheckFilesExistsItemDto implements FileExistsCheckItem {
  @Matches(/^[0-9a-f]{64}$/)
  @ApiProperty()
  checksumSha256!: string
}

export class CheckFilesExistsBodyDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CheckFilesExistsItemDto)
  @ApiProperty({ type: [CheckFilesExistsItemDto] })
  items!: CheckFilesExistsItemDto[]
}
