import { Injectable, OnModuleInit } from '@nestjs/common'
import * as Minio from 'minio'
import { Readable } from 'stream'
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

  async uploadFile(
    key: string,
    stream: Readable,
    size: number,
    contentType: string,
  ): Promise<void> {
    const env = loadEnv()
    await this.client.putObject(env.MINIO_BUCKET, key, stream, size, {
      'Content-Type': contentType,
    })
  }

  async downloadFile(key: string): Promise<Readable> {
    const env = loadEnv()
    return this.client.getObject(env.MINIO_BUCKET, key)
  }

  async deleteFile(key: string): Promise<void> {
    const env = loadEnv()
    await this.client.removeObject(env.MINIO_BUCKET, key)
  }

  async fileExists(key: string): Promise<boolean> {
    const env = loadEnv()
    try {
      await this.client.statObject(env.MINIO_BUCKET, key)
      return true
    } catch {
      return false
    }
  }

  getClient(): Minio.Client {
    return this.client
  }
}
