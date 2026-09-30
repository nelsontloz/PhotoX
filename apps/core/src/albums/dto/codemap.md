# apps/core/src/albums/dto/

## Responsibility

Request/response validation shapes for `AlbumsController`. Every DTO is decorated with `class-validator` and `@nestjs/swagger`; the create/update/list/add-assets DTOs also `implements` the matching wire interface from `@photox/shared-types` so drift breaks compilation.

## Design

- `CreateAlbumDto`: required `name` (string, max 255), optional `description` (string, max 2000).
- `UpdateAlbumDto`: optional `name` (max 255), optional `description` (max 2000); partial patches are allowed and empty patches are treated as no-op reads by the service.
- `ListAlbumsQueryDto`: `limit?` (`@Type(() => Number)`, 1..1000, default 20 in the service), `offset?` (min 0). `Type` transformation is needed because query strings arrive as strings.
- `AddAssetsBodyDto`: required `assetIds: string[]` with `@ArrayMaxSize(100)` and `@IsUUID('4', { each: true })`.
- Identity always comes from the verified `req.user`; the DTOs carry no `userId` fallback.
- All shapes are declared inline here — there is no shared base class or mapper; conversion to `AlbumDto` is done by `AlbumsService.toDto`.

## Flow

- Request body/query → global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` in core `main.ts` → typed DTO instance passed into `AlbumsController` methods.
- Unknown fields are rejected (400) rather than stripped silently, so clients cannot smuggle arbitrary properties.
- Query numbers (`limit`, `offset`) are converted by `class-transformer` before validation; booleans are not used in this folder.
- `AddAssetsBodyDto.assetIds` is validated after array transformation and then re-validated per-asset in the service (ownership + not trashed).

## Integration

- Consumed only by `AlbumsController` / `AlbumsService`.
- `CreateAlbumDto`, `UpdateAlbumDto`, `ListAlbumsQueryDto`, `AddAssetsBodyDto` implement `ICreateAlbumDto` / `IUpdateAlbumDto` / `IListAlbumsQueryDto` / `IAddAssetsToAlbumDto` from `@photox/shared-types`.
- Swagger metadata is picked up by core's `/docs` and `/docs-json` (both are open routes).
