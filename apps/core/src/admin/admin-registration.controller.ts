import { Body, Controller, Get, Patch } from '@nestjs/common'
import { ApiProperty, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { IsBoolean } from 'class-validator'
import type { RegistrationSettings } from '@photox/shared-types'
import { SettingsService } from '../settings/settings.service'

class UpdateRegistrationDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  enabled!: boolean
}

@ApiTags('admin')
@Controller('api/v1/admin/registration')
export class AdminRegistrationController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Public registration toggle state (admin-only)' })
  @ApiResponse({ status: 200, description: 'Current registration setting' })
  async getSettings(): Promise<RegistrationSettings> {
    return { enabled: await this.settings.isRegistrationEnabled() }
  }

  @Patch()
  @ApiOperation({ summary: 'Enable or disable public registration (admin-only)' })
  @ApiResponse({ status: 200, description: 'Updated registration setting' })
  async update(@Body() body: UpdateRegistrationDto): Promise<RegistrationSettings> {
    await this.settings.setRegistrationEnabled(body.enabled)
    return { enabled: body.enabled }
  }
}
