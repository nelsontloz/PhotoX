import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsNumber, IsString, ValidateNested } from 'class-validator'

// ponytail: shape-only validation here — cap/label/confidence/box rules reject with 422 in the
// service so the worker's CoreClient treats them as unrecoverable without retrying
export class DetectionBoxDto {
  @ApiProperty()
  @IsNumber()
  x!: number

  @ApiProperty()
  @IsNumber()
  y!: number

  @ApiProperty()
  @IsNumber()
  w!: number

  @ApiProperty()
  @IsNumber()
  h!: number
}

export class DetectedObjectDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  label!: string

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber()
  confidence!: number

  @ApiProperty({ type: DetectionBoxDto })
  @ValidateNested()
  @Type(() => DetectionBoxDto)
  box!: DetectionBoxDto
}

export class RegisterDetectionsDto {
  @ApiProperty({ type: [DetectedObjectDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectedObjectDto)
  detections!: DetectedObjectDto[]
}
