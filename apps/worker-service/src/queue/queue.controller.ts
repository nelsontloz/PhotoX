import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { ThumbnailProcessor } from './thumbnail.processor'
import { ProcessThumbnailDto, JobResponseDto } from './dto/process-thumbnail.dto'

@ApiTags('jobs')
@Controller('v1/jobs')
export class QueueController {
  constructor(private readonly processor: ThumbnailProcessor) {}

  @Post('thumbnail')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enqueue a thumbnail processing job' })
  @ApiResponse({ status: 201, type: JobResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  async enqueueThumbnail(@Body() dto: ProcessThumbnailDto) {
    return this.processor.enqueue(dto)
  }
}
