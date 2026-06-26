import { ApiProperty } from '@nestjs/swagger'
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { Type } from 'class-transformer'

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

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string

  @ApiProperty({ required: false, example: 'createdAt:desc' })
  @IsOptional()
  @IsString()
  @Matches(SORT_PATTERN)
  sort?: string

  @ApiProperty({ required: false, enum: ['user', 'admin'] })
  @IsOptional()
  @IsEnum(['user', 'admin'] as const)
  role?: 'user' | 'admin'
}
