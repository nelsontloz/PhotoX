# apps/core/src/users/

## Responsibility

User accounts, the four public auth endpoints, and the admin user-list endpoint. Owns the `users` and `refresh_tokens` tables, password hashing, access-token signing, and refresh-token rotation/revocation.

## Design

`UsersModule`:

- `TypeOrmModule.forFeature([User, RefreshToken])`.
- `JwtModule.registerAsync` → `loadAuthEnv().AUTH_TOKEN_SECRET`, HS256, `expiresIn: loadEnv().AUTH_ACCESS_TTL` (default 30m).
- Controllers: `AuthController` (`api/v1/auth`), `AdminController` (users admin, see `admin/`).
- Providers: `AuthService`, `AdminService`, `TokenService`.

`AuthService`:

- `register(email, password, displayName)`: duplicate email → 409 `ConflictException`; if `userRepo.count() === 0` the new user gets role `admin`, all later users `user` (first-run bootstrap); password hashed with `argon2.hash`; returns tokens.
- `login`: `argon2.verify`; unknown email and wrong password both → 401 `Invalid credentials` (no user enumeration).
- `refresh`: sha256-hashes the presented opaque token, loads `tokenHash` + `purpose='refresh'`, rejects if expired, then rotates atomically with `tokenRepo.update({ tokenHash, revokedAt: IsNull() }, { revokedAt: () => 'now()' })`; `affected === 0` means already used/revoked → 401. Rows are never deleted, only revoked.
- `logout`: revokes a live row if found, otherwise silent (idempotent 204).
- `issueTokens` (private): signs the access token, generates the opaque refresh token, persists only its hash plus `TokenService.getRefreshExpiresAt()`, returns `AuthResponse` (tokens + user profile with ISO dates).

Endpoints under `@Controller('api/v1/auth')` (all open routes per `apps/core/src/auth/open-routes.ts`):

- `POST register` → 201
- `POST login` → 200 (`@HttpCode(OK)`)
- `POST refresh` → 200
- `POST logout` → 204

Swagger tag `auth`; request DTOs in `dto/`, admin listing in `admin/`.

## Flow

Register/login/refresh → `AuthController` → `AuthService` → `TokenService` + repositories → `AuthResponse` → web stores `accessToken` + `refreshToken`. The conditional UPDATE guarantees a replayed refresh token cannot mint a second pair. `logout` only touches the presented token's row.

## Integration

- `JwtAuthGuard` allows `/api/v1/auth/*` unauthenticated and verifies Bearer tokens for everything else; `TokenService` signing parameters must match the guard (same `AUTH_TOKEN_SECRET`, HS256, `AUTH_CLOCK_TOLERANCE_SEC` clock tolerance).
- `AuthResponse`, `RegisterRequest`, `LoginRequest`, `RefreshRequest` live in `@photox/shared-types` and are implemented by the DTOs.
- `test/integration/helpers.ts` seeds `User`/`RefreshToken` rows directly and signs matching JWTs for API tests.
- Worker-service never touches these tables.
