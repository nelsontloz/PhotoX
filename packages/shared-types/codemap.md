# packages/shared-types/

## Responsibility

The wire contract between backend and frontend: plain TypeScript interfaces for every API
request/response shape (auth, users, files, assets, faces/persons, admin, albums, shares).
Core DTOs implement these types, the gateway only needs `Role`, and the web app imports them
over HTTP responses.

## Design

- Zero runtime code and zero runtime dependencies — the package compiles to declarations
  plus empty JS, so importing it never pulls code into a bundle. All unions are string
  literal types (`AssetKind`, `MetadataStatus`, statuses) rather than enums.
- `src/index.ts` is the primary barrel and re-exports the side modules with
  `export * from './albums'` and `export * from './shares'`.
- Timestamps are always `string` (ISO) on the wire, nullable DB-derived fields are
  `| null`, and asset processing state mirrors the entity columns (`metadataStatus`,
  `transcodeStatus`, `thumbnailStatus`, `faceStatus`) so polling clients can watch jobs.
- `FileRecord` here is the API shape of the entity (dates stringified); `data-access`
  exports the class — same name, different layer, so imports must be deliberate.
- Build: composite `tsc -b` to `dist/`; listed in `vitest.workspace.ts` (no spec files).

## Flow

Core controllers and DTOs type themselves from these interfaces → JSON responses → web hooks
and components (`useAlbums`, `TimelineGrid`, `AssetViewer`, `people/*`, `shared/*`) consume
the same names via `import type`. The gateway does not transform payloads, so drift shows up
as a type error in one of the consumers rather than at runtime.

## Integration

- `apps/core` — DTO classes (`file-record.dto`, `register-faces.dto`, `face.dto`, admin
  controllers/services) and mappers.
- `apps/gateway` — `Role` for guard checks.
- `apps/web` — nearly every API-touching module; `apps/web/test/pact/consumer/` still uses
  these types in the legacy consumer pact.
- `packages/shared-auth` — `Role` for `JwtPayload`.
