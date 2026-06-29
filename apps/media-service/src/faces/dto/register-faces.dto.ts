import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsNumber, IsUUID, ArrayMinSize, ValidateNested } from 'class-validator'
import type { RegisterFacesRequestDto, DetectedFaceInput } from '@photox/shared-types'
import { FaceBoxResponseDto } from './face.dto'

// ponytail: empty faces array is valid (no faces detected in the image) — service handles it, worker still patches faceStatus=ready+faceCount=0

export class DetectedFaceDto implements DetectedFaceInput {
  @ApiProperty({ type: FaceBoxResponseDto })
  @ValidateNested()
  @Type(() => FaceBoxResponseDto)
  box!: FaceBoxResponseDto

  @ApiProperty()
  @IsNumber()
  confidence!: number

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  embedding!: number[]
}

export class RegisterFacesDto implements RegisterFacesRequestDto {
  @ApiProperty({ type: [DetectedFaceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectedFaceDto)
  faces!: DetectedFaceDto[]

  @ApiProperty()
  @IsUUID()
  userId!: string
}
