import { BadRequestException, Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { Readable } from 'stream'
import { firstValueFrom } from 'rxjs'
import { SERVICE_URLS } from '@photox/shared-config'

@Injectable()
export class HlsProxyService {
  constructor(private readonly http: HttpService) {}

  async getMasterPlaylistText(hlsMasterKey: string): Promise<string> {
    const { userId, fileId, relPath } = this.splitHlsKey(hlsMasterKey)
    const url = `${SERVICE_URLS['file-storage-service']}/v1/internal/hls/files/${encodeURIComponent(userId)}/${encodeURIComponent(fileId)}/${relPath.split('/').map(encodeURIComponent).join('/')}`
    const res = await firstValueFrom(this.http.get(url, { responseType: 'text', timeout: 30_000 }))
    return res.data as string
  }

  async getHlsStream(hlsMasterKey: string): Promise<Readable> {
    const { userId, fileId, relPath } = this.splitHlsKey(hlsMasterKey)
    const url = `${SERVICE_URLS['file-storage-service']}/v1/internal/hls/files/${encodeURIComponent(userId)}/${encodeURIComponent(fileId)}/${relPath.split('/').map(encodeURIComponent).join('/')}`
    const res = await firstValueFrom(
      this.http.get(url, { responseType: 'stream', timeout: 30_000 }),
    )
    return res.data as Readable
  }

  async getOriginalFileStream(fileId: string, userId: string): Promise<Readable> {
    const url = `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/download?userId=${encodeURIComponent(userId)}`
    const res = await firstValueFrom(
      this.http.get(url, { responseType: 'stream', timeout: 30_000 }),
    )
    return res.data as Readable
  }

  private splitHlsKey(hlsMasterKey: string): { userId: string; fileId: string; relPath: string } {
    const hlsIdx = hlsMasterKey.indexOf('/hls/')
    if (hlsIdx === -1) {
      throw new BadRequestException('Invalid hlsMasterKey format')
    }
    const prefix = hlsMasterKey.slice(0, hlsIdx)
    const slashIdx = prefix.indexOf('/')
    if (slashIdx === -1) {
      throw new BadRequestException('Invalid hlsMasterKey format')
    }
    return {
      userId: prefix.slice(0, slashIdx),
      fileId: prefix.slice(slashIdx + 1),
      relPath: hlsMasterKey.slice(hlsIdx + '/hls/'.length),
    }
  }
}
