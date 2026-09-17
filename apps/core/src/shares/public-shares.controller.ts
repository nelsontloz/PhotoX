import { Controller, Get, Param, Req, Res } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { SharesService } from './shares.service'
import { UserFilesService } from '../files/user/user-files.service'
import { parseRangeHeader } from '../files/streaming.util'

@ApiTags('shares')
@Controller('api/share')
export class PublicSharesController {
  constructor(
    private readonly shares: SharesService,
    private readonly files: UserFilesService,
  ) {}

  @Get(':token')
  @ApiOperation({ summary: 'Get a shared asset by public token' })
  @ApiResponse({ status: 200, description: 'Shared asset info' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  async getByToken(@Param('token') token: string) {
    return this.shares.getByToken(token)
  }

  @Get(':token/stream')
  @ApiOperation({ summary: 'Stream a shared asset by public token (capability URL)' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 206, description: 'Partial content' })
  @ApiResponse({ status: 404, description: 'Share not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async streamByToken(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const share = await this.shares.getByToken(token)
    const fileId = share.asset.fileId
    const rangeHeader = req.headers.range

    if (rangeHeader) {
      const { totalSize } = await this.files.getFileStat(fileId)

      const range = parseRangeHeader(rangeHeader, totalSize)
      if (!range) {
        res.set('Content-Range', `bytes */${totalSize}`)
        res.status(416).end()
        return
      }

      const { stream, record } = await this.files.stream(fileId, { range })

      res.set({
        'Content-Type': record.mimeType,
        'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
        'Content-Length': String(range.end - range.start + 1),
        'Accept-Ranges': 'bytes',
      })
      res.status(206)
      stream.on('error', () => {
        res.destroy()
      })
      res.on('close', () => {
        stream.destroy()
      })
      stream.pipe(res)
      return
    }

    const { stream, record, totalSize } = await this.files.stream(fileId)
    res.set({
      'Content-Type': record.mimeType,
      'Content-Length': String(totalSize),
      'Accept-Ranges': 'bytes',
    })
    stream.on('error', () => {
      res.destroy()
    })
    res.on('close', () => {
      stream.destroy()
    })
    stream.pipe(res)
  }
}
