import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination-query.dto';

const SORT_PATTERN = /^(createdAt|displayName|email|role):(asc|desc)$/;

export class ListAdminUsersQueryDto extends PaginationQueryDto {
  // cap stays 50 (base allows 1000) — base validators merge with these, stricter wins.
  // offset inherited as-is (identical IsInt/Min(0)/default(0)).
  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  override limit = 20;

  @ApiProperty({
    required: false,
    maxLength: 100,
    description: 'Substring match on displayName or email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiProperty({
    required: false,
    example: 'createdAt:desc',
    pattern: '^(createdAt|displayName|email|role):(asc|desc)$',
  })
  @IsOptional()
  @IsString()
  @Matches(SORT_PATTERN)
  sort?: string;

  @ApiProperty({ required: false, enum: ['user', 'admin'] })
  @IsOptional()
  @IsEnum(['user', 'admin'] as const)
  role?: 'user' | 'admin';
}
