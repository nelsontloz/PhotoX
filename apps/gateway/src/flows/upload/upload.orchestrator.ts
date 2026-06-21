import { Injectable, BadRequestException, BadGatewayException, Logger } from '@nestjs/common'
import type { Request } from 'express'
import type { Readable } from 'stream'
import Busboy from 'busboy'
import FormData from 'form-data'
import { randomUUID } from 'crypto'
import { ProxyService } from '../../proxy/proxy.service'
import { buildHeaders } from '../../proxy/common/headers'
import { SERVICE_URLS } from '@photox/shared-config'
import type { FileRecord, Asset } from '@photox/shared-types'
import type { CurrentUser } from '../../auth/current-user.decorator'

interface ParsedUpload {
  file: Readable
  fileMeta: { filename: string; mimeType: string }
  fields: Record<string, string>
}

function parseMultipart(req: Request): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers })
    let file: Readable | null = null
    const fileMeta = { filename: '', mimeType: '' }
    const fields: Record<string, string> = {}

    busboy.on(
      'file',
      (_fieldname: string, fileStream: Readable, info: { filename: string; mimeType: string }) => {
        file = fileStream
        fileMeta.filename = info.filename
        fileMeta.mimeType = info.mimeType
      },
    )

    busboy.on('field', (name: string, val: string) => {
      fields[name] = val
    })

    busboy.on('finish', () => {
      if (!file) return reject(new BadRequestException('No file uploaded'))
      resolve({ file, fileMeta, fields })
    })

    busboy.on('error', reject)
    req.pipe(busboy)
  })
}

@Injectable()
export class UploadOrchestrator {
  private readonly logger = new Logger(UploadOrchestrator.name)

  constructor(private readonly proxy: ProxyService) {}

  async execute(user: CurrentUser, req: Request): Promise<{ asset: Asset; file: FileRecord }> {
    const requestId = (req.headers['x-request-id'] as string) ?? ''
    const parsed = await parseMultipart(req)

    const kind = parsed.fields.kind
    if (!kind || !['photo', 'video'].includes(kind)) {
      throw new BadRequestException('kind must be "photo" or "video"')
    }

    const idempotencyKey = randomUUID()

    const form = new FormData()
    form.append('file', parsed.file, {
      filename: parsed.fileMeta.filename,
      contentType: parsed.fileMeta.mimeType,
    })

    const fileResult = await this.proxy.forwardFormData<FileRecord>(
      `${SERVICE_URLS['file-storage-service']}/v1/files`,
      form,
      buildHeaders(user, requestId, { 'x-idempotency-key': idempotencyKey }),
    )

    try {
      const assetResult = await this.proxy.forward<Asset>(SERVICE_URLS['media-service'], {
        method: 'POST',
        path: 'v1/assets',
        body: {
          fileId: fileResult.data.id,
          kind,
          ...(parsed.fields.title ? { title: parsed.fields.title } : {}),
          ...(parsed.fields.description ? { description: parsed.fields.description } : {}),
          ...(parsed.fields.takenAt ? { takenAt: parsed.fields.takenAt } : {}),
        },
        headers: buildHeaders(user, requestId, { 'x-idempotency-key': idempotencyKey }),
        timeout: 30_000,
      })

      return { asset: assetResult.data, file: fileResult.data }
    } catch (err) {
      this.logger.error({
        requestId,
        fileId: fileResult.data.id,
        error: (err as Error).message,
      })
      throw new BadGatewayException({
        statusCode: 502,
        reason: 'asset_creation_failed',
        message: 'Asset creation failed after file upload',
        traceId: requestId,
      })
    }
  }
}
