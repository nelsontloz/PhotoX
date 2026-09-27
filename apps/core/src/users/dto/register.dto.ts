import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator'
import type { RegisterRequest } from '@photox/shared-types'

export class RegisterDto implements RegisterRequest {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  email!: string

  @ApiProperty({ minLength: 8, maxLength: 128, example: 'correcthorsebatterystaple' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string

  @ApiProperty({ minLength: 1, maxLength: 64, example: 'Ada Lovelace' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  displayName!: string
}
