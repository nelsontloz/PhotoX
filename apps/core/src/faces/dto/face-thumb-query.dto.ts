import { ApiProperty } from '@nestjs/swagger'
import { IsOptional } from 'class-validator'
import { Transform } from 'class-transformer'

export class FaceThumbQueryDto {
  // @Transform, not @Type(() => Number): an empty `?size=` must stay NaN (default-size
  // sentinel), while @Type would coerce it to 0
  @IsOptional()
  @Transform(({ value }) => (value === '' ? Number.NaN : Number(value)))
  @ApiProperty({
    required: false,
    description: 'Square crop size in px (clamped 32-600, default 240)',
  })
  size?: number
}
