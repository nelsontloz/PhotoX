import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsString, MinLength } from 'class-validator'
import type { LoginRequest } from '@photox/shared-types'

export class LoginDto implements LoginRequest {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  email!: string

  @ApiProperty({ minLength: 1, example: 'correcthorsebatterystaple' })
  @IsString()
  @MinLength(1)
  password!: string
}
