import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'

// ponytail: the asset/album/upload bodies share these exact caps (title 255, description 2000)
// — one base so a future cap change can't drift between endpoints
export class DescriptionDto {
  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string
}

export class TitleDescriptionDto extends DescriptionDto {
  @ApiProperty({ required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string
}
