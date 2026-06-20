import { Injectable, Inject, BadGatewayException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'

@Injectable()
export class FileStorageClient {
  constructor(
    private readonly http: HttpService,
    @Inject('FILE_STORAGE_BASE_URL') private readonly baseUrl: string,
  ) {}

  async deleteFile(fileId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete(`${this.baseUrl}/v1/internal/files/${fileId}`, { timeout: 10_000 }),
      )
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404 || status === 204) return
      throw new BadGatewayException(
        `file-storage delete failed: ${status ?? 'service unreachable'}`,
      )
    }
  }
}
