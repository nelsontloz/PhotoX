/**
 * The one list envelope (`GET /api/v1/assets`, `/albums`, `/albums/:id/assets`, `/persons`,
 * `/search`, `/admin/users`, `/shares`, `/api/share/:token/assets`).
 *
 * `total` is the endpoint's match count: the whole filtered set for stored collections, and the
 * candidate/returned count for ranked ones (`/search`, `duplicates`, `similar`), which cap paging
 * at that number. It is never a page size.
 *
 * `nextCursor` is `null` on the last page and absent on the endpoints paginated by `offset` only
 * (`/albums`, `/persons`, `/admin/users`). The timeline keeps its own `nextOffset`/`version`
 * contract — it is a sync protocol, not a list.
 */
export interface Page<T> {
  items: T[];
  total: number;
  nextCursor?: string | null;
}
