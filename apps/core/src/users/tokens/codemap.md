# apps/core/src/users/tokens/

## Responsibility

All token cryptography and lifetime math for auth: HS256 access-token signing, opaque refresh-token generation/hashing, and refresh TTL calculation. The single place where `crypto` primitives are applied to credentials.

## Design

`TokenService` (one provider, injected into `AuthService`):

- `signAccessToken(user)` → `jwtService.signAsync({ sub, email, role, jti: randomUUID() })`. Secret/algorithm/TTL come from `UsersModule`'s `JwtModule.registerAsync` (`loadAuthEnv().AUTH_TOKEN_SECRET`, HS256, `loadEnv().AUTH_ACCESS_TTL`). Payload matches `JwtPayload` in `@photox/shared-types`.
- `generate()` → `randomBytes(32).toString('base64url')` — the opaque refresh token handed to clients.
- `hash(token)` → sha256 hex, the only form stored in `refresh_tokens.tokenHash`.
- `getRefreshExpiresAt()` → `new Date(Date.now() + parseDuration(loadEnv().AUTH_REFRESH_TTL))`.
- `parseDuration` accepts only `^(\d+)([mhd])$`; unrecognised input silently falls back to 15 minutes. ponytail ceiling: no seconds/weeks — extend the regex if config ever needs finer TTLs.

No JWT verification lives here; verification is `JwtAuthGuard`'s job via the shared secret.

## Flow

`AuthService.issueTokens` → `signAccessToken` + `generate`/`hash` → hash persisted with expiry. `login`/`refresh`/`logout` call `hash` to look up the presented token. The access token is never stored server-side; its `jti` is generated but currently unused for revocation.

## Integration

- Env: `AUTH_TOKEN_SECRET` (required, ≥32 chars), `AUTH_ACCESS_TTL` (30m default), `AUTH_REFRESH_TTL` (30d default) from `@photox/shared-config`; `JwtAuthGuard` reads the same secret plus `AUTH_CLOCK_TOLERANCE_SEC` (60s).
- `UsersModule` supplies `JwtService`; `TokenService` has no repository dependency, keeping hashing/expiry testable in isolation.
