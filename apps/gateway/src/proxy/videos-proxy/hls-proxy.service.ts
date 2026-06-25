import { Injectable, OnModuleInit } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import * as Minio from 'minio'
import { Readable } from 'stream'
import { firstValueFrom } from 'rxjs'
import { loadEnv } from '@photox/shared-config'
import { SERVICE_URLS } from '@photox/shared-config'

@Injectable()
export class HlsProxyService implements OnModuleInit {
  private client!: Minio.Client
  private bucket!: string

  constructor(private readonly http: HttpService) {}

  onModuleInit() {
    const env = loadEnv()
    this.bucket = env.MINIO_BUCKET
    this.client = new Minio.Client({
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: false,
      accessKey: env.MINIO_ROOT_USER,
      secretKey: env.MINIO_ROOT_PASSWORD,
    })
  }

  async getMasterPlaylistText(key: string): Promise<string> {
    const stream = await this.client.getObject(this.bucket, key)
    return this.streamToString(stream)
  }

  async getHlsStream(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key)
  }

  async getOriginalFileStream(fileId: string, userId: string): Promise<Readable> {
    const url = `${SERVICE_URLS['file-storage-service']}/v1/files/${fileId}/download?userId=${encodeURIComponent(userId)}`
    const res = await firstValueFrom(
      this.http.get(url, { responseType: 'stream', timeout: 30_000 }),
    )
    return res.data as Readable
  }

  private streamToString(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      stream.on('error', reject)
    })
  }
}
