import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import type { AdminUserUpdateRequest } from '@photox/shared-types'

// Every field is optional: the global ValidationPipe (whitelist + forbidNonWhitelisted)
// 400s anything undeclared, so this class is the complete accepted-body contract.
export class UpdateAdminUserDto implements AdminUserUpdateRequest {
  @ApiProperty({ required: false, minLength: 1, maxLength: 64, example: 'Ada Lovelace' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  displayName?: string

  @ApiProperty({ required: false, example: 'user@example.com', description: 'User email address' })
  @IsOptional()
  // trim BEFORE @IsEmail: an admin pasting '  user@example.com  ' would otherwise
  // 400 at the pipe, long before the service can normalize it
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email?: string

  @ApiProperty({
    required: false,
    minLength: 8,
    maxLength: 128,
    example: 'correcthorsebatterystaple',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string
}
