# apps/web/src/

## Responsibility

Application root of the web SPA: bootstrap, route assembly and the CSS entry. Holds the top-level folders (`api`, `store`, `hooks`, `lib`, `components`, `pages`) but almost no logic itself.

## Design

- `main.tsx`: `createRoot(document.getElementById('root')!)` + `StrictMode`, wraps `App` in `BrowserRouter`, imports `./app.css` (Tailwind v4 `@import "tailwindcss"` + `@theme` tokens).
- `App.tsx`: a single `useRoutes(routes)` call over `virtual:generated-pages-react` — routes are derived from `src/pages/**` by `vite-plugin-pages` (`importMode: 'async'`, so each page is a lazy chunk).
- `env.d.ts`: triple-slash refs to `vite/client` and `vite-plugin-pages/client-react`, typing `import.meta.env` and the virtual routes module.
- No providers beyond `BrowserRouter`, no theme context — styles are dark-only; auth/session lives in zustand.
- File-route convention (owned by `pages/`): `pages/index.tsx` → `/`, `pages/albums/[id].tsx` → `/albums/:id`, `pages/share/[token].tsx` → `/share/:token`.

## Flow

1. `/src/main.tsx` boots once; `BrowserRouter` supplies location context.
2. `App` resolves the current URL to a lazy page component from the generated route table.
3. Pages themselves pull in guards (`RequireAuth`/`RequireAdmin`), hooks, stores and `AppShell`/`AppHeader` — there is no global layout wrapper at this level.

## Integration

- `src/pages/*` supplies the route table through the virtual module; pages consume everything else in `src/`.
- `src/app.css` carries the Tailwind theme used by components; `../index.html` mounts `#root` and the `dark` class.
- Env typing only — `VITE_API_URL` is read by `vite.config.ts` proxy, not by app code (`src/api/client.ts` always uses relative `/api`).
