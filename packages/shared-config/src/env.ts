import { existsSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { z } from 'zod';

/** `15m`/`2h`/`30d` -> milliseconds; unparseable values fall back to 15 minutes. */
function parseDurationMs(duration: string): number {
  const match = /^(\d+)([mhd])$/.exec(duration);
  if (!match) return 15 * 60 * 1000;

  const value = parseInt(match[1]!, 10);
  // regex restricts the unit to m|h|d, so the assertion is safe and the switch is exhaustive
  switch (match[2] as 'm' | 'h' | 'd') {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
  }
}

const envSchema = z.object({
  API_PORT: z.coerce.number().default(3000),
  CORE_URL: z.string().default('http://localhost:3000'),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_USER: z.string().default('photox'),
  POSTGRES_PASSWORD: z.string().default('photox_dev'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  // logical Redis database index (SELECT n). 0 in production; the integration harness gives
  // every spec file its own index so rate-limit buckets and BullMQ keys stay file-local.
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  STORAGE_DIR: z.string().default('./data/storage'),
  STORAGE_QUOTA_BYTES: z.coerce.number().int().positive().optional(),
  S3_BACKUP_BUCKET: z.string().default('photox-dev-backups'),
  S3_ENDPOINT: z.string().default('http://localhost:4566'),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default('test'),
  AWS_SECRET_ACCESS_KEY: z.string().default('test'),
  S3_BACKUP_PREFIX: z.string().default('backups/'),
  AUTH_ACCESS_TTL: z.string().default('30m'),
  // raw env value is a duration string; consumers get milliseconds, parsed exactly once
  AUTH_REFRESH_TTL: z.string().default('1d').transform(parseDurationMs),
  AUTH_CLOCK_TOLERANCE_SEC: z.coerce.number().default(60),
});

type Env = z.infer<typeof envSchema>;

function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/**
 * Loads `.env` from the workspace root (or cwd) into `process.env`, replacing the envFilePath
 * `['../../.env', '.env']` that @nestjs/config used to provide. Existing process env wins —
 * same precedence as node --env-file — so compose/CI env and tests are untouched.
 */
export function loadRootEnvFile(): void {
  const root = findWorkspaceRoot(process.cwd());
  for (const candidate of [join(root, '.env'), join(process.cwd(), '.env')]) {
    if (existsSync(candidate)) process.loadEnvFile(candidate);
  }
}

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment variables: ${JSON.stringify(errors)}`);
  }

  // ponytail: anchor relative STORAGE_DIR at the workspace root — api and worker run with different cwds, so a bare relative default pointed each at its own package dir
  const storageDir = parsed.data.STORAGE_DIR;
  return {
    ...parsed.data,
    STORAGE_DIR: isAbsolute(storageDir)
      ? storageDir
      : resolve(findWorkspaceRoot(process.cwd()), storageDir),
  };
}

// ponytail: entropy floor for every JWT secret — length alone accepts 'a'.repeat(32).
// generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
function hasSecretEntropy(secret: string): boolean {
  if (new Set(secret).size < 16) return false;
  return !/(.)\1{5}/.test(secret);
}

const secretField = (name: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 characters`)
    .refine(hasSecretEntropy, { message: `${name} is too predictable — generate a random one` });

const authEnvSchema = z
  .object({
    AUTH_TOKEN_SECRET: secretField('AUTH_TOKEN_SECRET'),
    AUTH_TOKEN_SECRET_PREVIOUS: secretField('AUTH_TOKEN_SECRET_PREVIOUS').optional(),
    WORKER_JWT_SECRET: secretField('WORKER_JWT_SECRET'),
  })
  // equal user/worker secrets silently collapse the split — previous-equals-current stays
  // allowed (rotation overlap), only the worker secret must differ
  .refine((v) => v.WORKER_JWT_SECRET !== v.AUTH_TOKEN_SECRET, {
    message: 'WORKER_JWT_SECRET must differ from AUTH_TOKEN_SECRET — the split is void otherwise',
    path: ['WORKER_JWT_SECRET'],
  });

type AuthEnv = z.infer<typeof authEnvSchema>;

export function loadAuthEnv(): AuthEnv {
  const parsed = authEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid auth environment: ${JSON.stringify(errors)}`);
  }

  return parsed.data;
}

export const FACE_DETECTOR_MODEL_FILE = 'det_10g.onnx';

// ponytail: FACE_DETECTOR_MODEL_PATH stays a direct env read outside the zod schema
// (WORKER_SERVICE_PORT precedent) — shared so core and worker resolve the same default model path
export function resolveFaceDetectorModelPath(): string {
  return (
    process.env.FACE_DETECTOR_MODEL_PATH ??
    join(loadEnv().STORAGE_DIR, 'models', FACE_DETECTOR_MODEL_FILE)
  );
}
