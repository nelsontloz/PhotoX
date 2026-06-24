import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { ThumbnailProcessor } from './thumbnail.processor'
import { VideoProcessor } from './video.processor'
import { ProcessThumbnailDto, JobResponseDto } from './dto/process-thumbnail.dto'
import { ProcessVideoDto } from './dto/process-video.dto'

@ApiTags('jobs')
@Controller('v1/jobs')
export class QueueController {
  constructor(
    private readonly thumbnailProcessor: ThumbnailProcessor,
    private readonly videoProcessor: VideoProcessor,
  ) {}

  @Post('thumbnail')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enqueue a thumbnail processing job' })
  @ApiResponse({ status: 201, type: JobResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  async enqueueThumbnail(@Body() dto: ProcessThumbnailDto) {
    return this.thumbnailProcessor.enqueue(dto)
  }

  @Post('video')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enqueue a video HLS transcode job' })
  @ApiResponse({ status: 201, type: JobResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  async enqueueVideo(@Body() dto: ProcessVideoDto) {
    return this.videoProcessor.enqueue(dto)
  }
}
