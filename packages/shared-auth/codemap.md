# packages/shared-auth/

## Responsibility

The auth contract shared by every process that touches identity: `JwtPayload` (the shape of
the HS256 access token) and `loadAuthEnv()` (validation of the required token secret). It
deliberately contains no crypto, no guards, and no Nest decorators — signing and
verification live in core; only the payload type and env contract are shared.

## Design

- `JwtPayload` is a plain interface: `{ sub, email, role: Role, iat, exp, jti? }` where
  `Role` comes from `@photox/shared-types` (`'user' | 'admin'`). Core signs and verifies
  with the same type, so a payload change breaks compilation at both call sites.
- `loadAuthEnv()` parses `process.env` with zod: `AUTH_TOKEN_SECRET: z.string().min(32)`.
  No default — a missing or too-short secret throws `Invalid auth environment: {…}` with
  flattened field errors. TTLs (`AUTH_ACCESS_TTL`, `AUTH_REFRESH_TTL`,
  `AUTH_CLOCK_TOLERANCE_SEC`) intentionally live in `shared-config`, not here.
- Dependencies: zod + `@photox/shared-types`. Builds via `tsc -b` to `dist/` (no spec files today).

## Flow

Apps call `loadAuthEnv()` lazily at point of use — core's `auth.module.ts` inside a
`useFactory`, `users.module.ts` when wiring the token service — so a bad secret
fails app bootstrap, not package import. The returned secret signs access tokens in core
and verifies them in core's `JwtAuthGuard` (HS256, exp check, `AUTH_CLOCK_TOLERANCE_SEC`
tolerance).

## Integration

- `apps/core/src/auth/jwt-auth.guard.ts` — `jwt.verify<JwtPayload>()` and role
  checks for admin routes; `apps/core/src/auth/auth.module.ts` — `loadAuthEnv().AUTH_TOKEN_SECRET`.
- `apps/core/src/users/users.module.ts` — `loadAuthEnv()` for the service that signs
  access/refresh token pairs.
- `apps/web/src/store/auth-store.ts` — `jwtDecode<JwtPayload>` to read `sub`/`exp` locally
  (type-only import).
