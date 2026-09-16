import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
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
  @ApiOperation({ summary: 'Create a public share link for an asset' })
  @ApiResponse({ status: 201, description: 'Share created' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async create(@Body() dto: CreateShareDto, @Req() req: Request) {
    const userId = (req.user as { id: string }).id ?? dto.userId
    return this.shares.create(userId, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List all shares created by a user' })
  @ApiResponse({ status: 200, description: 'Paginated share list' })
  async list(@Req() req: Request, @Query('userId') queryUserId?: string) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    return this.shares.list(userId)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a share link' })
  @ApiResponse({ status: 204, description: 'Share revoked' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  async revoke(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('userId') queryUserId?: string,
  ) {
    const userId = (req.user as { id: string }).id ?? queryUserId
    await this.shares.revoke(userId, id)
  }

  @Get('public/:token')
  @ApiOperation({ summary: 'Get a shared asset by public token' })
  @ApiResponse({ status: 200, description: 'Shared asset info' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  async getByToken(@Param('token') token: string) {
    return this.shares.getByToken(token)
  }
}
