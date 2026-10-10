import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  ArrayMaxSize,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator'
import {
  FACE_DETECTOR_KINDS,
  type RegisterFacesRequestDto,
  type DetectedFaceInput,
  type FaceDetectorKind,
} from '@photox/shared-types'
import { FaceBoxResponseDto } from './face.dto'

// ponytail: empty faces array is valid (no faces detected in the image) — service handles it, worker still patches faceStatus=ready+faceCount=0

export class DetectedFaceDto implements DetectedFaceInput {
  @ApiProperty({ type: FaceBoxResponseDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => FaceBoxResponseDto)
  box!: FaceBoxResponseDto

  @ApiProperty()
  @IsNumber()
  confidence!: number

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(512)
  @ArrayMaxSize(512)
  @IsNumber({}, { each: true })
  embedding!: number[]
}

export class RegisterFacesDto implements RegisterFacesRequestDto {
  @ApiProperty({ type: [DetectedFaceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectedFaceDto)
  faces!: DetectedFaceDto[]

  @ApiPropertyOptional({ enum: FACE_DETECTOR_KINDS })
  @IsOptional()
  @IsIn(FACE_DETECTOR_KINDS)
  detector?: FaceDetectorKind
}
