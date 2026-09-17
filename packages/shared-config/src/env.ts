import { existsSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().default(3000),
  GATEWAY_PORT: z.coerce.number().default(3001),
  CORE_BASE_URL: z.string().default('http://localhost:3000'),
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

function findWorkspaceRoot(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    throw new Error(`Invalid environment variables: ${JSON.stringify(errors)}`)
  }

  // ponytail: anchor relative STORAGE_DIR at the workspace root — api and worker run with different cwds, so a bare relative default pointed each at its own package dir
  const storageDir = parsed.data.STORAGE_DIR
  return {
    ...parsed.data,
    STORAGE_DIR: isAbsolute(storageDir)
      ? storageDir
      : resolve(findWorkspaceRoot(process.cwd()), storageDir),
  }
}
