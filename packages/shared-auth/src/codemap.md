# packages/shared-auth/src/

## Responsibility

Two files, two exports. `env.ts` owns validation of the single auth secret; `index.ts`
owns the `JwtPayload` wire contract and re-exports the env helper. This is the whole
package — no services, no DI, no side effects at import.

## Design

`env.ts`:

- `authEnvSchema = z.object({ AUTH_TOKEN_SECRET: z.string().min(32, 'AUTH_TOKEN_SECRET must
be at least 32 characters') })`.
- `type AuthEnv = z.infer<typeof authEnvSchema>` — the schema is the type.
- `loadAuthEnv(): AuthEnv` uses `safeParse(process.env)`; on failure throws
  `Error('Invalid auth environment: ' + JSON.stringify(flatten().fieldErrors))`, naming the
  offending key without echoing values. It does not load `.env` itself — core
  supplies the environment (ConfigModule or process env).

`index.ts`:

- `export { loadAuthEnv, type AuthEnv } from './env'`.
- `export interface JwtPayload { sub: string; email: string; role: Role; iat: number;
exp: number; jti?: string }` — `Role` imported type-only from `@photox/shared-types`.

Design notes: the payload mirrors what `jsonwebtoken` puts on the wire
(seconds-since-epoch `iat`/`exp`); `jti` is optional so refresh/rotation metadata can be
added without breaking verification; everything here is parse- or type-only, so importing
the package never performs work.

## Flow

Consumer calls `loadAuthEnv()` → zod validates `process.env` → either throws with field
errors or returns `{ AUTH_TOKEN_SECRET }` typed as `AuthEnv`. `JwtPayload` is erased at
compile time; it only shapes `jwt.sign` / `jwt.verify` / `jwtDecode` call sites.

## Integration

Imported by `apps/core` (secret for signing + verification) and
`apps/web` (payload decode, type-only). The package is part of the vitest workspace but has
no spec files; validation behavior is covered indirectly by app bootstrap.
