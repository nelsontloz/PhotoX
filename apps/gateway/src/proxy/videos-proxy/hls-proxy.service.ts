import { BadRequestException, Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { Readable } from 'stream'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'

@Injectable()
export class HlsProxyService {
  constructor(private readonly http: HttpService) {}

  async fetchHls(key: string, responseType: 'text'): Promise<string>
  async fetchHls(key: string, responseType: 'stream'): Promise<Readable>
  async fetchHls(key: string, responseType: 'text' | 'stream'): Promise<string | Readable> {
    const { userId, fileId, relPath } = this.splitHlsKey(key)
    const url = `${SERVICE_URLS['file-storage-service']}/v1/internal/hls/files/${encodeURIComponent(userId)}/${encodeURIComponent(fileId)}/${relPath.split('/').map(encodeURIComponent).join('/')}`
    const res = await firstValueFrom(
      this.http.get(url, { responseType: responseType, timeout: 30_000 }),
    )
    return res.data as string | Readable
  }

  async getOriginalFileStream(fileId: string, userId: string): Promise<Readable> {
    const url = `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/download?userId=${encodeURIComponent(userId)}`
    const res = await firstValueFrom(
      this.http.get(url, { responseType: 'stream', timeout: 30_000 }),
    )
    return res.data as Readable
  }

  private splitHlsKey(hlsMasterKey: string): { userId: string; fileId: string; relPath: string } {
    const parts = hlsMasterKey.split('/hls/')
    if (parts.length !== 2) {
      throw new BadRequestException('Invalid hlsMasterKey format')
    }
    const prefix = parts[0]!
    const relPath = parts[1]!
    const ids = prefix.split('/')
    const userId = ids[0]
    const fileId = ids[1]
    if (!userId || !fileId) {
      throw new BadRequestException('Invalid hlsMasterKey format')
    }
    return { userId, fileId, relPath }
  }
}
