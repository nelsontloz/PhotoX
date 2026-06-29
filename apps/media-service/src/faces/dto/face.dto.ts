import { ApiProperty } from '@nestjs/swagger'
import { IsNumber, Min } from 'class-validator'
import type { FaceDto } from '@photox/shared-types'

export class FaceBoxResponseDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  x!: number

  @ApiProperty()
  @IsNumber()
  @Min(0)
  y!: number

  @ApiProperty()
  @IsNumber()
  @Min(0)
  w!: number

  @ApiProperty()
  @IsNumber()
  @Min(0)
  h!: number
}

export class FaceResponseDto implements FaceDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  assetId!: string

  @ApiProperty({ type: FaceBoxResponseDto })
  box!: FaceBoxResponseDto

  @ApiProperty()
  confidence!: number

  @ApiProperty({ nullable: true })
  personId!: string | null
}
