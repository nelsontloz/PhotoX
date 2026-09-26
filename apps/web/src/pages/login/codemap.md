# apps/web/src/pages/login/

## Responsibility

`/login` — public email/password sign-in form. Boots a session in `auth-store`; not wrapped in `AppShell` or any guard, and redirects to `/` when already authenticated.

## Design

- Local state for `email`, `password`, `showPassword`; submit calls `useAuthStore.login(email, password)` (store sets `status: 'loading'`, stores `user`/`accessToken`/`refreshToken`, else `status: 'error'` + message).
- Success is detected by re-reading `useAuthStore.getState().status === 'authenticated'` after `await`, then `navigate('/')` (the store is async and React state isn't awaited).
- If `status === 'authenticated'` on render, returns `<Navigate to="/" replace>`; `loading` disables the button with a spinner; `error` renders a dismissable banner (`clearError` on click).
- Password visibility toggle (eye icons) is local; "Forgot password?" is an inert `href="#"` placeholder; footer links to `/register`.
- Note: `RequireAuth` redirects unauthenticated users here with `state.from`, but login does not consume it — it always navigates `/`.
- Form relies on native HTML validation (`required`, `type="email"`); no client-side regex or password rules.
- `handleSubmit` ignores the returned promise and re-reads store status because `login()` catches errors internally and never rejects.
- The error banner persists until clicked (calls `clearError`), so it does not disappear while the user types.
- Session persistence (refresh token in `persist`) and the pre-expiry refresh timer live entirely in `auth-store`, not on this page.
- Static footer shows `PhotoX v2.4.0`; the layout is duplicated by `/register` rather than extracted.

## Flow

Mount (already logged in → redirect `/`) → credentials submitted → `api/auth.login` POST `/api/v1/auth/login` → tokens persisted by `auth-store` (`persist`, refresh rotation scheduled ~5 min before expiry) → `navigate('/')` → timeline fetches attach `Authorization: Bearer` via `api/client` interceptor.

## Integration

`store/auth-store` (only store used), `api/auth` through it, `react-router-dom` `Link`/`Navigate`/`useNavigate`. The route is in the open table (`api/v1/auth/*`), so it works without a token. Register page shares this exact layout/structure.
