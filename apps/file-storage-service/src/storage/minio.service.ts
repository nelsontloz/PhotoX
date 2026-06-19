import { Injectable, OnModuleInit } from '@nestjs/common'
import * as Minio from 'minio'
import { loadEnv } from '@photox/shared-config'

@Injectable()
export class MinioService implements OnModuleInit {
  private client: Minio.Client

  constructor() {
    const env = loadEnv()
    this.client = new Minio.Client({
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: false,
      accessKey: env.MINIO_ROOT_USER,
      secretKey: env.MINIO_ROOT_PASSWORD,
    })
  }

  async onModuleInit() {
    const env = loadEnv()
    const exists = await this.client.bucketExists(env.MINIO_BUCKET)
    if (!exists) {
      await this.client.makeBucket(env.MINIO_BUCKET)
    }
  }

  async ping(): Promise<void> {
    await this.client.listBuckets()
  }

  getClient(): Minio.Client {
    return this.client
  }
}
