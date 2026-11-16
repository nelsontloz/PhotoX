/**
 * The deprecation wave, in one place. This registry is both what the API promises and what it does:
 * `DeprecationInterceptor` sends the headers and `swagger/deprecations.ts` marks the operations, so a
 * route cannot be half-deprecated (announced in the docs but still answering normally).
 *
 * A route stays functional until `sunset`; removing it is the next release's job. Every entry names
 * its replacement, because a deprecation without one is just a deletion with extra steps.
 */
export interface Deprecation {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';
  /** Express-style path, params as `:name` — the same template `/docs-json` carries. */
  path: string;
  replacement?: { method: string; path: string };
  /** ISO instant the route disappears, sent as `Sunset`. */
  sunset: string;
}

/** The day this wave shipped; `Deprecation` (RFC 9745) reports it, `Sunset` reports the removal. */
export const DEPRECATED_ON = '2026-11-16T00:00:00Z';

const NEXT_MAJOR = '2027-11-16T00:00:00Z';

export const DEPRECATIONS: readonly Deprecation[] = [
  // Release 2 — resource-shaped replacements for RPC paths and duplicate aliases.
  {
    method: 'POST',
    path: '/api/v1/assets/bulk-trash',
    replacement: { method: 'POST', path: '/api/v1/assets/trash' },
    sunset: NEXT_MAJOR,
  },
  {
    method: 'GET',
    path: '/api/v1/assets/:id/content/download',
    replacement: { method: 'GET', path: '/api/v1/assets/:id/content' },
    sunset: NEXT_MAJOR,
  },
  {
    method: 'POST',
    path: '/api/v1/admin/cleanup-orphans/run',
    replacement: { method: 'POST', path: '/api/v1/admin/cleanup-orphans' },
    sunset: NEXT_MAJOR,
  },
  {
    method: 'GET',
    path: '/api/share/:token/stream',
    replacement: { method: 'GET', path: '/api/share/:token/content' },
    sunset: NEXT_MAJOR,
  },
  {
    method: 'GET',
    path: '/api/share/:token/assets/:assetId/stream',
    replacement: { method: 'GET', path: '/api/share/:token/assets/:assetId/content' },
    sunset: NEXT_MAJOR,
  },

  // Backups addressed by a path key instead of a query selector.
  {
    method: 'GET',
    path: '/api/v1/admin/backups/status',
    replacement: { method: 'GET', path: '/api/v1/admin/backups/:key' },
    sunset: NEXT_MAJOR,
  },
  {
    method: 'GET',
    path: '/api/v1/admin/backups/progress',
    replacement: { method: 'GET', path: '/api/v1/admin/backups/:key/progress' },
    sunset: NEXT_MAJOR,
  },
  {
    method: 'DELETE',
    path: '/api/v1/admin/backups',
    replacement: { method: 'DELETE', path: '/api/v1/admin/backups/:key' },
    sunset: NEXT_MAJOR,
  },
  {
    method: 'POST',
    path: '/api/v1/admin/restores',
    replacement: { method: 'POST', path: '/api/v1/admin/backups/:key/restores' },
    sunset: NEXT_MAJOR,
  },

  // One reprocess-run resource instead of six POST/GET pairs. Spelled out rather than generated:
  // places/backfill is not a `<kind>/reprocess` path and thumbnails never had a status GET, so a
  // typo here would deprecate nothing (and the doc test would not catch a generated path).
  ...(
    [
      { path: '/api/v1/admin/faces/reprocess', kind: 'faces', status: true },
      { path: '/api/v1/admin/embeddings/reprocess', kind: 'embeddings', status: true },
      { path: '/api/v1/admin/detections/reprocess', kind: 'detections', status: true },
      { path: '/api/v1/admin/metadata/reprocess', kind: 'metadata', status: true },
      { path: '/api/v1/admin/places/backfill', kind: 'places', status: true },
      { path: '/api/v1/admin/thumbnails/reprocess', kind: 'thumbnails', status: false },
    ] as const
  ).flatMap(({ path, kind, status }) => [
    {
      method: 'POST' as const,
      path,
      replacement: { method: 'POST', path: '/api/v1/admin/reprocess-runs' },
      sunset: NEXT_MAJOR,
    },
    ...(status
      ? [
          {
            method: 'GET' as const,
            path,
            replacement: { method: 'GET', path: `/api/v1/admin/reprocess-runs/${kind}` },
            sunset: NEXT_MAJOR,
          },
        ]
      : []),
  ]),
];

/** Express-style registry path (`:id`) → the OpenAPI path template (`{id}`). */
export function toDocPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function escapeSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathMatcher(path: string): RegExp {
  const pattern = path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : escapeSegment(segment)))
    .join('/');
  return new RegExp(`^${pattern}$`, 'i');
}

const MATCHERS = DEPRECATIONS.map((deprecation) => ({
  deprecation,
  matcher: pathMatcher(deprecation.path),
}));

/** The deprecation covering this request, if any. Case-insensitive like the router. */
export function deprecationFor(method: string, path: string): Deprecation | undefined {
  const upper = method.toUpperCase();
  return MATCHERS.find(
    ({ deprecation, matcher }) => deprecation.method === upper && matcher.test(path),
  )?.deprecation;
}
