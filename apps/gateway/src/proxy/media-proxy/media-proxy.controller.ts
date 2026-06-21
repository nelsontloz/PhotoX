import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request } from 'express'
import { CurrentUser, type CurrentUser as CurrentUserType } from '../../auth/current-user.decorator'
import { ProxyService } from '../proxy.service'
import { buildHeaders } from '../common/headers'
import { SERVICE_URLS } from '@photox/shared-config'

@ApiTags('media')
@Controller('api/v1/assets')
export class MediaProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Get(':id/thumbnails')
  @ApiOperation({ summary: 'List all thumbnails for an asset' })
  @ApiResponse({ status: 200, description: 'Thumbnail list' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getThumbnails(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Req() req: Request,
  ) {
    return this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'GET',
      path: `v1/assets/${id}/thumbnails`,
      headers: buildHeaders(user, (req.headers['x-request-id'] as string) ?? ''),
    })
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update asset metadata' })
  @ApiResponse({ status: 200, description: 'Asset updated' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserType,
    @Req() req: Request,
  ) {
    return this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'PATCH',
      path: `v1/assets/${id}`,
      body,
      headers: buildHeaders(user, (req.headers['x-request-id'] as string) ?? ''),
    })
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete (trash) an asset' })
  @ApiResponse({ status: 204, description: 'Asset trashed' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async delete(@Param('id') id: string, @CurrentUser() user: CurrentUserType, @Req() req: Request) {
    await this.proxy.forward(SERVICE_URLS['media-service'], {
      method: 'DELETE',
      path: `v1/assets/${id}`,
      headers: buildHeaders(user, (req.headers['x-request-id'] as string) ?? ''),
    })
  }
}
