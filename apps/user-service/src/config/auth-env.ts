import { z } from 'zod'

const authEnvSchema = z.object({
  AUTH_TOKEN_SECRET: z
    .string()
    .min(32, 'AUTH_TOKEN_SECRET must be at least 32 characters'),
  AUTH_CLOCK_TOLERANCE_SEC: z.coerce.number().default(60),
})

export type AuthEnv = z.infer<typeof authEnvSchema>

export function loadAuthEnv(): AuthEnv {
  const parsed = authEnvSchema.safeParse(process.env)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    throw new Error(`Invalid auth environment: ${JSON.stringify(errors)}`)
  }

  return parsed.data
}
