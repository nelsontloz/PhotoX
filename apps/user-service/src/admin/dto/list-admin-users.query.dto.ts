import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'

const SORT_PATTERN = /^(createdAt|displayName|email|role):(asc|desc)$/

export class ListAdminUsersQueryDto {
  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number

  @ApiProperty({
    required: false,
    maxLength: 100,
    description: 'Substring match on displayName or email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string

  @ApiProperty({
    required: false,
    example: 'createdAt:desc',
    pattern: '^(createdAt|displayName|email|role):(asc|desc)$',
  })
  @IsOptional()
  @IsString()
  @Matches(SORT_PATTERN)
  sort?: string

  @ApiProperty({ required: false, enum: ['user', 'admin'] })
  @IsOptional()
  @IsEnum(['user', 'admin'] as const)
  role?: 'user' | 'admin'
}
