import { Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'

@Injectable()
export class HlsHttpClient {
  constructor(private readonly http: HttpService) {}

  async uploadBatch(
    userId: string,
    fileId: string,
    files: { key: string; body: Buffer; contentType: string }[],
  ): Promise<void> {
    if (files.length === 0) return
    const paths: string[] = []
    const form = new FormData()
    form.append('userId', userId)
    form.append('fileId', fileId)
    for (const f of files) {
      const relPath = f.key.slice(`${userId}/${fileId}/hls/`.length)
      paths.push(relPath)
      const blob = new Blob([f.body], { type: f.contentType })
      form.append('files', blob, relPath)
    }
    form.append('paths', JSON.stringify(paths))
    await firstValueFrom(
      this.http.post(`${SERVICE_URLS['file-storage-service']}/v1/hls/files/batch`, form, {
        timeout: 5 * 60 * 1000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }),
    )
  }
}
