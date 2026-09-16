import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsArray, IsOptional, IsString, ArrayMaxSize, ArrayMinSize } from 'class-validator'

export class UserIdsQueryDto {
  @ApiProperty({
    required: false,
    description: 'Comma-separated user IDs. Maximum 50.',
    example: 'uuid1,uuid2,uuid3',
    type: String,
  })
  @IsOptional()
  @Transform(({ value }: { value: string | undefined }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  userIds?: string[]
}
