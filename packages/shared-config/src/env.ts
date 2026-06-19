import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_PORT: z.coerce.number().default(3000),
  USER_SERVICE_PORT: z.coerce.number().default(3001),
  LIBRARY_SERVICE_PORT: z.coerce.number().default(3002),
  FILE_STORAGE_SERVICE_PORT: z.coerce.number().default(3003),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_USER: z.string().default('photox'),
  POSTGRES_PASSWORD: z.string().default('photox_dev'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ROOT_USER: z.string().default('photox'),
  MINIO_ROOT_PASSWORD: z.string().default('photox_dev'),
  MINIO_BUCKET: z.string().default('photox-files'),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    throw new Error(`Invalid environment variables: ${JSON.stringify(errors)}`)
  }

  return parsed.data
}
