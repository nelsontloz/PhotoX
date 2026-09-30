# apps/web/

## Responsibility

Vite 6 + React 18 + TypeScript SPA (`@photox/web`, :5173) — the only browser-facing surface of PhotoX. Renders auth, timeline, albums, people, places, favorites, trash, share and admin UI, and reaches the backend exclusively through same-origin `/api` (Vite dev proxy in front of core). Holds no business logic or DB access; all data is server state plus client-side view state.

## Design

- `package.json`: `react-router-dom@7`, `zustand@5`, `axios`, `leaflet` (places map); workspace dep `@photox/shared-types` (wire types + `JwtPayload`). Tests: Vitest 3 + Testing Library + jsdom; the legacy pact consumer test lives in `test/pact/consumer/` and is not part of `verify`.
- `vite.config.ts`: plugins `react()`, `tailwindcss()` (Tailwind v4 CSS config — theme lives in `src/app.css`, no `tailwind.config.*`), `Pages({ importMode: 'async' })` (file routes), plus a dev-only `suppressEconnreset` plugin that destroys ECONNRESET sockets to silence logs from aborted requests.
- Server: `host 0.0.0.0`, `port 5173`; proxy `/api` and `/health` → `process.env.VITE_API_URL || http://localhost:3000` (core). Docker compose sets `VITE_API_URL=http://core:3000`; host dev defaults to localhost core.
- `build.rollupOptions.output.manualChunks.vendor` splits react/react-dom/react-router/zustand/axios/jwt-decode into a vendor chunk.
- Vitest inline config: `globals: true`, `environment: 'jsdom'`, `passWithNoTests`.
- `tsconfig.json` covers `src` (DOM libs, `react-jsx`, bundler resolution, `noEmit`); `tsconfig.node.json` covers `vite.config.ts`; both extend the strict root `tsconfig.base.json`.
- `index.html` hard-codes `<html class="dark">` + Inter font — dark is the only theme.

## Flow

1. `index.html` loads `/src/main.tsx` into `#root`.
2. `main.tsx` mounts `StrictMode > BrowserRouter > App`; `App.tsx` renders `useRoutes(routes)` where routes come from `vite-plugin-pages`' `virtual:generated-pages-react` (one async chunk per page).
3. Every data request goes to `/api/...`; the Vite dev proxy forwards it to core (there is no separate proxy service; compose publishes no core port).

## Integration

- Upstream: core :3000 (Bearer JWT); `web` reaches it only through the same-origin `/api` proxy.
- Shared packages: `@photox/shared-types` for DTO/wire shapes and `JwtPayload`.
- Inside the app: `src/api` (HTTP), `src/store` (zustand), `src/hooks` (fetch/grouping), `src/lib` (upload/thumb/format helpers), `src/components`, `src/pages` (file routes).
- Docker: `Dockerfile` runs the Vite dev server (not a static build) on :5173 with `VITE_API_URL=http://core:3000`.
