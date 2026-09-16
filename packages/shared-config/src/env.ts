import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_PORT: z.coerce.number().default(3000),
  API_PORT: z.coerce.number().default(3000),
  WORKER_SERVICE_PORT: z.coerce.number().default(3004),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_USER: z.string().default('photox'),
  POSTGRES_PASSWORD: z.string().default('photox_dev'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  STORAGE_DIR: z.string().default('./data/storage'),
  AUTH_ACCESS_TTL: z.string().default('30m'),
  AUTH_REFRESH_TTL: z.string().default('30d'),
  AUTH_CLOCK_TOLERANCE_SEC: z.coerce.number().default(60),
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
