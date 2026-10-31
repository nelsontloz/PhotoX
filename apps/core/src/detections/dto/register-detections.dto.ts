import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsPositive,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

export class DetectionBoxDto {
  @ApiProperty()
  @IsNumber()
  x!: number

  @ApiProperty()
  @IsNumber()
  y!: number

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  w!: number

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  h!: number
}

export class DetectedObjectDto {
  @ApiProperty({ minLength: 1, maxLength: 64 })
  @IsString()
  @Length(1, 64)
  @Matches(/\S/)
  label!: string

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence!: number

  @ApiProperty({ type: DetectionBoxDto })
  @ValidateNested()
  @Type(() => DetectionBoxDto)
  box!: DetectionBoxDto
}

export class RegisterDetectionsDto {
  @ApiProperty({ type: [DetectedObjectDto], maxItems: 200 })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DetectedObjectDto)
  detections!: DetectedObjectDto[]
}
