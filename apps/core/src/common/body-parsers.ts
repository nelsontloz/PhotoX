import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';

// A face job posts the asset's whole face set: 512 floats per face (≈10 KB of JSON with the box),
// so a ~10-person photo exceeds the Nest default 100 KB body limit. Worker payloads are the only
// big ones — raise the limit for /worker only and keep 100 KB everywhere else. The first parser
// consumes the request, so the app-wide json() below skips it (body-parser checks the finished
// request) instead of reparsing an empty body.
export const WORKER_JSON_LIMIT = '5mb';

export function configureBodyParsers(app: NestExpressApplication): void {
  app.use('/worker', json({ limit: WORKER_JSON_LIMIT }));
  app.use(json());
  app.use(urlencoded({ extended: true }));
}
