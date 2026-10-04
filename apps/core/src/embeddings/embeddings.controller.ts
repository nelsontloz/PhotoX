import { Body, Controller, Param, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { EmbeddingsService } from './embeddings.service'
import { RegisterEmbeddingDto } from './dto/register-embedding.dto'

@ApiTags('embeddings')
@Controller('api/v1/assets')
export class EmbeddingsController {
  constructor(private readonly embeddings: EmbeddingsService) {}

  @Post(':id/embedding')
  @ApiOperation({ summary: 'Register the image embedding for an asset (idempotent upsert)' })
  @ApiResponse({ status: 201, description: 'Embedding registered' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  @ApiResponse({ status: 422, description: 'Unsupported kind/model or wrong embedding dimensions' })
  async registerEmbedding(
    @Param('id') id: string,
    @Body() dto: RegisterEmbeddingDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const userId = (req.user as { id: string }).id
    return this.embeddings.register(id, userId, dto)
  }
}
