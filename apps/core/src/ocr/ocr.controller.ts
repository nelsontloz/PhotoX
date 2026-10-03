import { Body, Controller, Param, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { OcrService } from './ocr.service'
import { RegisterOcrDto } from './dto/register-ocr.dto'

@ApiTags('ocr')
@Controller('api/v1/assets')
export class OcrController {
  constructor(private readonly ocr: OcrService) {}

  @Post(':id/ocr')
  @ApiOperation({ summary: 'Register the concatenated OCR text for an asset (idempotent upsert)' })
  @ApiResponse({ status: 201, description: 'OCR row registered' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  @ApiResponse({ status: 422, description: 'Empty/oversized text or invalid lang/confidence' })
  async registerOcr(
    @Param('id') id: string,
    @Body() dto: RegisterOcrDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const userId = (req.user as { id: string }).id
    return this.ocr.register(id, userId, dto)
  }
}
