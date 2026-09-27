# apps/web/src/pages/register/

## Responsibility

`/register` — public account creation form (full name, email, password, confirm password). Creates the session immediately on success and redirects to `/`.

## Design

- Local state for the four fields plus two visibility toggles; client-side validation is only the confirm-password match (`passwordError`), everything else (required, email format) is native HTML validation.
- Submit calls `useAuthStore.register(email, password, fullName)`; on `status === 'authenticated'` (re-read from `getState()`), `navigate('/')`. Store errors and local `passwordError` share one dismissable banner (`passwordError ?? error`), cleared via `clearError`.
- Already-authenticated users get `<Navigate to="/" replace>`; loading disables the button with a spinner. No `AppShell`, no guards — same centered card layout and version footer as `/login`.
- Password match check happens before the API call, so mismatches never hit the backend.
- `fullName` is passed as the store's `displayName` argument; the store call signature is `register(email, password, displayName)`.
- The stored `status`/`error` banner, initial `Navigate` redirect, and loading button behavior mirror `/login` exactly, as does the static version footer.
- On success the user is signed in immediately — there is no email-confirmation step in the UI or API surface used here.
- No `state.from` handling: registration always lands on `/`, even if it was triggered from a deep link attempt.
- Validation is native HTML plus the local mismatch check; no password strength rules are enforced client-side.

## Flow

Mount → `Navigate` if session exists → fill form → mismatch short-circuits locally → `api/auth.register` POST `/api/v1/auth/register` → `auth-store` persists tokens/user → `navigate('/')` → protected pages pass `RequireAuth`. The endpoint is in the open table, so no prior session is required.

## Integration

`store/auth-store` (`register`, `status`, `error`, `clearError`), `api/auth` (indirect), `react-router-dom` (`Link` to `/login`, `Navigate`, `useNavigate`). No other stores, hooks, or components are used.
