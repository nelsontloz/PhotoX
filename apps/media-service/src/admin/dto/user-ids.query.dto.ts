import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString, ArrayMaxSize, ArrayMinSize } from 'class-validator'
import { Transform } from 'class-transformer'

export class UserIdsQueryDto {
  @ApiProperty({
    required: false,
    description: 'Comma-separated user IDs. Maximum 50.',
    example: 'uuid1,uuid2,uuid3',
    type: String,
  })
  @IsOptional()
  @Transform(({ value }): string[] =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  userIds?: string[]
}
