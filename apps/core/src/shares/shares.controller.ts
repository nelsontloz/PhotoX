import { Controller, Get, Post, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { CurrentUserId } from '../auth/jwt-auth.guard'
import { SharesService } from './shares.service'
import { CreateShareDto } from './dto/create-share.dto'

@ApiTags('shares')
@Controller('api/v1/shares')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a public share link for an asset or an album' })
  @ApiResponse({ status: 201, description: 'Share created' })
  @ApiResponse({ status: 400, description: 'Provide exactly one of assetId or albumId' })
  @ApiResponse({ status: 404, description: 'Asset or album not found' })
  async create(@Body() dto: CreateShareDto, @CurrentUserId() userId: string) {
    return this.shares.create(userId, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List all shares created by a user' })
  @ApiResponse({ status: 200, description: 'Share list' })
  async list(@CurrentUserId() userId: string) {
    return this.shares.list(userId)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a share link' })
  @ApiResponse({ status: 204, description: 'Share revoked' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  async revoke(@Param('id') id: string, @CurrentUserId() userId: string) {
    await this.shares.revoke(userId, id)
  }
}
