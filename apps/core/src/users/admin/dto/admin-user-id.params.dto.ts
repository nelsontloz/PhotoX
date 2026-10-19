import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

export class AdminUserIdParamsDto {
  @ApiProperty({ description: 'Target user id (UUID)' })
  @IsUUID()
  id!: string
}
