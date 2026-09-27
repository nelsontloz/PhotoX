# apps/core/src/users/dto/

## Responsibility

Request bodies for the four public auth endpoints. Each DTO is the runtime validation surface for a `@photox/shared-types` wire request interface.

## Design

Each DTO `implements` its shared-types counterpart, so wire/validation drift fails `typecheck`:

- `RegisterDto implements RegisterRequest` — `email` `@IsEmail()`; `password` `@IsString()` 8–128 chars; `displayName` `@IsString()` 1–64 chars.
- `LoginDto implements LoginRequest` — `email` `@IsEmail()`; `password` `@IsString()` `@MinLength(1)` (no complexity/length policy on login: legacy hashes may predate the register policy).
- `RefreshDto implements RefreshRequest` — declared in `logout.dto.ts` so `refresh` and `logout` share one body shape; `refreshToken` `@IsString()` `@IsNotEmpty()` — the opaque base64url token, not a JWT.

No `class-transformer` decorators: these bodies are JSON only (no multipart), so no coercion is needed; the global `transform: true` is still what makes `ValidationPipe` instantiate the DTO classes with their metadata. All properties carry `@ApiProperty` (example/minLength/maxLength) for `/docs`.

## Flow

Body → global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` → validated instance → controller extracts primitives (`AuthService.register(dto.email, dto.password, dto.displayName)`, etc.). DTO instances are never passed into services.

## Integration

- Interfaces live in `@photox/shared-types` (`RegisterRequest`, `LoginRequest`, `RefreshRequest`) and are also used by the web client.
- `forbidNonWhitelisted` makes unexpected body properties a 400 — part of the API contract covered by the JWT integration specs.
- A validation failure never reaches `AuthService`: the pipe rejects first and `HttpExceptionFilter` serializes the class-validator message array.
