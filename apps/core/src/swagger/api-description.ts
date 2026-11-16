/**
 * The one prose contract published in `/docs-json` (`info.description`) and rendered by Swagger UI.
 * Keep it in the document, not in a README: this is the copy clients and the web app read.
 */
export const API_DESCRIPTION = `PhotoX is a personal photo and video library. Every route below is the contract.

## Pagination

Every list answers \`Page<T>\` = \`{ items, total, nextCursor? }\`. \`limit\` and \`offset\` are request-only and are never echoed in the body. \`total\` is the endpoint's match count, not a page size. "Walk" is how a client pages through the set; a cursor never combines with a non-zero offset (400 \`INVALID_CURSOR\`).

| Collection | Walk | Limit cap | \`total\` means |
| --- | --- | --- | --- |
| \`/api/v1/assets\` | cursor (\`nextCursor\`; the first page may also use \`offset\`) | 100 | \`total\` = matching rows in the filtered set |
| \`/api/v1/search\` | offset (\`limit\` / \`offset\`) | 100 | \`total\` = ranked candidates returned for the query |
| Admin users (\`/api/v1/admin/users\`) | offset (\`limit\` / \`offset\`) | 50 | \`total\` = users matching the filter |
| \`/api/v1/albums\` | offset (\`limit\` / \`offset\`) | 1000 | \`total\` = albums owned by the caller |
| \`/api/v1/persons\` | offset (\`limit\` / \`offset\`) | 1000 | \`total\` = persons owned by the caller |
| Album assets (\`/api/v1/albums/{id}/assets\`) | cursor (\`nextCursor\`) | 100 | \`total\` = assets in that album |
| \`/api/v1/shares\` | cursor (\`nextCursor\`) | 200 | \`total\` = share links created by the caller |
| Admin backup overview (\`/api/v1/admin/backups/overview\`) | offset (\`limit\` / \`offset\`) | 1000 | \`total\` = all rows before the slice |

Timeline windows are the one declared exception: \`/api/v1/timeline/window\` keeps \`nextOffset\` and \`version\` for the scroll track.

## Versioning

\`/api/v1\` is additive-only: new optional fields, new routes and new error codes may appear at any time, a client must ignore what it does not know, and nothing existing is renamed, removed or repurposed. Breaking changes are deferred to \`/api/v2\`, served beside v1.

## Stability of the surfaces

\`/api/share/*\` is permanently frozen: the public link shape is a capability URL that may already have been copied, printed or embedded, so it will never change. \`/worker/*\` and \`/health\` are internal plumbing between the API and its workers — not part of this contract, subject to change without notice, and never reachable with a user session.

## Writes

JSON PATCH is last-write-wins: send the fields you want changed and they replace the stored values. There are no conditional requests — no \`If-Match\`, no \`ETag\` validators and no 409 for a stale read; single-user edit conflicts are not modelled.

## Deprecation

A route or field that is going away is marked \`deprecated: true\` in this document, sends a \`Sunset\` header where a date is known, and stays functional for at least one release. Removal happens only at the next major version, and only after that release of overlap.

## Errors

Every non-2xx body is one envelope: \`{ statusCode, code, message, details?, retryAfterSec?, requestId }\`. \`code\` is a stable, closed union — branch on it, never on the prose \`message\`; unknown codes are a contract bug.

One deliberate deviation from RFC 7807: there is no separate problem type, but a request whose \`Accept\` header includes \`application/problem+json\` gets the same envelope serialized under that media type, plus the aliases \`status\` (= \`statusCode\`) and \`detail\` (= \`message\`). A plain \`application/json\` request keeps the byte-compatible canonical body.
`;
