import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator'

export class ApplyClusterCreateDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  clusterLabel!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  faceIds!: string[]

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('4')
  coverFaceId?: string
}

export class ApplyClusterAttachDto {
  @ApiProperty()
  @IsUUID('4')
  personId!: string

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  faceIds!: string[]

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('4')
  coverFaceId?: string
}

export class ApplyClustersDto {
  @ApiProperty({ type: [ApplyClusterCreateDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplyClusterCreateDto)
  creates!: ApplyClusterCreateDto[]

  @ApiProperty({ type: [ApplyClusterAttachDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplyClusterAttachDto)
  attaches!: ApplyClusterAttachDto[]
}
