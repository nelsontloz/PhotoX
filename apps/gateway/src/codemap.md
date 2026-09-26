# apps/gateway/src/

## Responsibility
- Composition root of the gateway: `app.module.ts` wires the feature modules; `main.ts` bootstraps Nest with the shared HTTP conventions.
- `AppModule` imports, in order:
  - `ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] })` — global config, workspace-root `.env` first, cwd-local `.env` second.
  - `GatewayAuthModule` — global JWT guard.
  - `ProxyModule` — the `/api/*` forwarder.
  - `HealthModule` — `/health` probe.
- Config being global means every `loadEnv()` consumer (guard, proxy, health) reads the same resolved env.

## Design
- Boot: `loadEnv()` (shared-config, zod) resolves `GATEWAY_PORT` (3001) and `CORE_BASE_URL`; `NestFactory.create(AppModule, { rawBody: true })` keeps raw bodies available while leaving multipart streams unparsed.
- Shared HTTP stack with core (mandatory, keep in sync):
  - `app.use(requestIdMiddleware)` first.
  - `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` global.
  - `HttpExceptionFilter` global.
  - Swagger `DocumentBuilder` (title "PhotoX Gateway", v1.0) served at `docs` with `jsonDocumentUrl: 'docs-json'`.
- Gateway-only addition: `app.enableCors({ origin: ['http://localhost:5173', 'http://0.0.0.0:5173'], credentials: true })` — core has no CORS because browsers never reach it.
- No global prefix; feature controllers own their paths (`health`, `/api/*splat`). Auth is global via `APP_GUARD` inside `GatewayAuthModule`, not wired here.
- `console.log` on listen is the only startup log; no custom logger config.

## Flow
1. Request hits Express → `requestIdMiddleware` stamps `x-request-id` (client value or `randomUUID`).
2. Global `ValidationPipe` parses any DTO (proxy routes have none) → global `GatewayAuthGuard`: open route passes, otherwise Bearer verified / 401, admin check / 403.
3. Routing: `ProxyController` (`/api/*`) or `HealthController` (`/health`); thrown errors land in `HttpExceptionFilter`.
4. `bootstrap()` calls `app.listen(env.GATEWAY_PORT)`; `void bootstrap()` discards the returned promise.

## Integration
- `GatewayAuthModule` provides the global guard and a JwtModule secret from `loadAuthEnv().AUTH_TOKEN_SECRET`.
- `ProxyModule` is the only module that talks to core (`CORE_BASE_URL`); `HealthModule` also pings core `/health` directly with a 3s timeout.
- Serves Swagger UI at `/docs` + `/docs-json`, both in the guard's open table.
