# apps/core/src/common/filters/

## Responsibility

Single catch-all exception filter defining the core API's error response contract.

## Design

`HttpExceptionFilter implements ExceptionFilter`, decorated `@Catch()`:

- `exception instanceof HttpException` → use `getStatus()` and `getResponse()` **verbatim**. Nest validation errors (`{ statusCode: 400, message: [...] }`), guard 401/403 shapes, and service exceptions all pass through unchanged — which is why the identity-guard spec can assert exactly `{ statusCode: 401, message: 'Unauthorized' }`.
- Any other throwable → `500 { statusCode: 500, message: 'Internal server error' }`; the real error is deliberately not leaked to clients.
- Responses with `status >= 500` are logged via `Logger.error` including the serialized body; 4xx stay silent.
- Single exit: `response.status(status).json(body)`.

No error codes, no request-id echo, no correlation metadata in the body.

## Flow

Exception thrown anywhere in the pipeline → Nest global filter (`app.useGlobalFilters(new HttpExceptionFilter())` in `src/main.ts`) catches and writes the JSON response.

## Integration

- Integration tests construct the filter the same way (`test/integration/helpers.ts`) so error shapes match production.
- The gateway proxy preserves core status and body downstream; the 500-body convention is what the web client sees through the gateway.
