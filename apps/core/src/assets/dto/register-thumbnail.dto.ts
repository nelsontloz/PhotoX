import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsUUID, IsInt, Min } from 'class-validator'

export class RegisterThumbnailDto {
  @ApiProperty({ example: 'sm', description: 'Thumbnail size label' })
  @IsIn(['sm', 'md', 'lg', 'xl'])
  size!: 'sm' | 'md' | 'lg' | 'xl'

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
