import { Controller, Post, Req, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger'
import type { Request } from 'express'
import { CurrentUser, type CurrentUser as CurrentUserType } from '../../auth/current-user.decorator'
import { UploadOrchestrator } from './upload.orchestrator'

@ApiTags('flows.upload')
@Controller('api/v1/assets')
export class UploadController {
  constructor(private readonly upload: UploadOrchestrator) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file and create asset in one flow' })
  @ApiResponse({ status: 201, description: 'Asset and file created' })
  @ApiResponse({ status: 502, description: 'Asset creation failed after file upload' })
  async handleUpload(@Req() req: Request, @CurrentUser() user: CurrentUserType) {
    return this.upload.execute(user, req)
  }
}
