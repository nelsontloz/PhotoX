import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import type { AdminUserCreateRequest, Role } from '@photox/shared-types'

export class CreateAdminUserDto implements AdminUserCreateRequest {
  @ApiProperty({ minLength: 1, maxLength: 64, example: 'Ada Lovelace' })
  @IsString()
  // trim BEFORE @MinLength: createUser stores the trimmed name, so '   ' would be a 400
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(64)
  displayName!: string

  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  // trim BEFORE @IsEmail: an admin pasting '  user@example.com  ' would otherwise
  // 400 at the pipe, long before the service can normalize it
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email!: string

  @ApiProperty({ minLength: 8, maxLength: 128, example: 'correcthorsebatterystaple' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string

  @ApiProperty({ required: false, enum: ['user', 'admin'], default: 'user' })
  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: Role
}
