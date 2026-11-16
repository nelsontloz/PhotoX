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

/**
 * Empty since Release 3 removed the 2026-11 wave. Retiring a route is still one entry here: the
 * interceptor and the document post-processor read this list, so a future wave needs no new wiring.
 */
export const DEPRECATIONS: readonly Deprecation[] = [];

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
