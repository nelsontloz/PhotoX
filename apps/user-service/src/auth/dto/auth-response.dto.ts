import { ApiProperty } from '@nestjs/swagger'
import type { AuthResponse, User } from '@photox/shared-types'

export class UserDto implements User {
  @ApiProperty()
  id!: string

  @ApiProperty()
  email!: string

  @ApiProperty()
  displayName!: string

  @ApiProperty({ required: false })
  avatarUrl?: string

  @ApiProperty()
  createdAt!: string

  @ApiProperty()
  updatedAt!: string
}

export class AuthResponseDto implements AuthResponse {
  @ApiProperty()
  accessToken!: string

  @ApiProperty()
  refreshToken!: string

  @ApiProperty({ type: UserDto })
  user!: UserDto
}
