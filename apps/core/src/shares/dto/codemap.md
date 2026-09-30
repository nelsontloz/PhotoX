# apps/core/src/shares/dto/

## Responsibility

Request validation for creating asset shares.

## Design

- `CreateShareDto implements CreateShareRequest` (from `@photox/shared-types`): required `assetId` (`@IsUUID('4')`).
- The asset must belong to the caller and not be trashed — that check is in `SharesService.create`, not expressible in the DTO.
- No DTO exists for the read/revoke/stream routes: `token` and `id` are raw path params, and `getByToken` takes no user identity.
- `shares/dto/` contains only this file; because create is idempotent, a retry with the same `assetId` returns the original share and token — there is no `force`/rotate flag.
- No update DTO: shares are immutable; the only lifecycle operations are create (idempotent) and delete.

## Flow

- `POST api/v1/shares` body → global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) → `CreateShareDto` → `SharesService.create(userId, dto)`.
- A missing/invalid `assetId` fails with 400 before any DB query; a valid but unowned/trashed asset yields 404 from the service.
- The caller identity comes from `req.user.id` (`JwtAuthGuard`); the DTO carries no `userId`.

## Integration

- Consumed by `SharesController` (`api/v1/shares`).
- `CreateShareRequest` wire contract comes from `@photox/shared-types`; the response type `AssetShareDto` includes token and thumbnail/file ids and is built in `SharesService.toDto`.
- Swagger schema is exposed on core's `/docs` (`/docs*` is an open route).
