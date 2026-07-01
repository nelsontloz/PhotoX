import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { ProxyService } from '../proxy.service'
import { SERVICE_URLS } from '@photox/shared-config'

@ApiTags('shares')
@Controller('api/v1/shares')
export class SharesProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a share link for an asset' })
  @ApiResponse({ status: 201, description: 'Share created' })
  async create(@Body() dto: Record<string, unknown>, @Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'POST',
      path: 'v1/shares',
      body: { ...dto, userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Get()
  @ApiOperation({ summary: 'List my share links' })
  @ApiResponse({ status: 200, description: 'Share list' })
  async list(@Req() req: Request) {
    const result = await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: 'v1/shares',
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
    return result.data
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a share link' })
  @ApiResponse({ status: 204, description: 'Share revoked' })
  async revoke(@Param('id') id: string, @Req() req: Request) {
    await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'DELETE',
      path: `v1/shares/${id}`,
      query: { userId: (req.user as { id: string }).id },
      headers: {
        'x-request-id': (req.headers['x-request-id'] as string) ?? '',
      },
      timeout: 30_000,
    })
  }
}
