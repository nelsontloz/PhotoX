import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsUUID, IsInt, Min, MaxLength } from 'class-validator'

export class RegisterThumbnailDto {
  @ApiProperty({ example: 'sm', description: 'Thumbnail size label' })
  @IsString()
  @MaxLength(50)
  size!: string

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  fileId!: string

  @ApiProperty({ example: 320 })
  @IsInt()
  @Min(1)
  width!: number

  @ApiProperty({ example: 240 })
  @IsInt()
  @Min(1)
  height!: number

  @ApiProperty({ example: 24576 })
  @IsInt()
  @Min(0)
  bytes!: number
}
