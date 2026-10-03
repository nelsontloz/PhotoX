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
  async create(@Body() dto: CreateShareDto, @Req() req: Request) {
    return this.shares.create((req.user as { id: string }).id, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List all shares created by a user' })
  @ApiResponse({ status: 200, description: 'Share list' })
  async list(@Req() req: Request) {
    const userId = (req.user as { id: string }).id
    return this.shares.list(userId)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a share link' })
  @ApiResponse({ status: 204, description: 'Share revoked' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  async revoke(@Param('id') id: string, @Req() req: Request) {
    await this.shares.revoke((req.user as { id: string }).id, id)
  }
}
