import { Injectable, OnModuleInit } from '@nestjs/common'
import * as Minio from 'minio'
import { Readable } from 'stream'
import { loadEnv } from '@photox/shared-config'

@Injectable()
export class HlsStorageService implements OnModuleInit {
  private client!: Minio.Client
  private bucket!: string
  private publicEndpoint!: string

  async onModuleInit() {
    const env = loadEnv()
    this.bucket = env.MINIO_BUCKET
    this.publicEndpoint = env.MINIO_PUBLIC_ENDPOINT
    this.client = new Minio.Client({
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: false,
      accessKey: env.MINIO_ROOT_USER,
      secretKey: env.MINIO_ROOT_PASSWORD,
    })

    const exists = await this.client.bucketExists(this.bucket)
    if (!exists) {
      await this.client.makeBucket(this.bucket)
    }

    if (process.env.NODE_ENV !== 'production') {
      const policyResource = `arn:aws:s3:::${this.bucket}/*/hls/*`
      const policy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [policyResource],
          },
        ],
      })
      await this.client.setBucketPolicy(this.bucket, policy)
    }
  }

  async uploadHlsFile(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, body, body.length, {
      'Content-Type': contentType,
    })
  }

  async uploadHlsFiles(
    files: { key: string; body: Buffer; contentType: string }[],
    concurrency = 16,
  ): Promise<void> {
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency)
      await Promise.all(batch.map((f) => this.uploadHlsFile(f.key, f.body, f.contentType)))
    }
  }

  async getHlsFileBuffer(key: string): Promise<Buffer> {
    return this.streamToBuffer(await this.client.getObject(this.bucket, key))
  }

  getHlsFileStream(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key)
  }

  getBucketName(): string {
    return this.bucket
  }

  getEndpoint(): string {
    return this.publicEndpoint
  }

  /** @deprecated Prod must proxy HLS bytes through the gateway. Retained for dev convenience only. */
  getPublicUrl(key: string): string {
    return `${this.publicEndpoint}/${this.bucket}/${key}`
  }

  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  }
}
