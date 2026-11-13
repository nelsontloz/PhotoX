import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { configureBodyParsers } from './common/body-parsers';
import { requestIdMiddleware } from './common/request-id';
import { loadEnv } from '@photox/shared-config';

async function bootstrap() {
  const env = loadEnv();
  // bodyParser disabled: the parsers are installed by configureBodyParsers so the /worker
  // face-registration body can exceed the 100 KB default (see that file). Keep the test app
  // helper in sync (apps/core/test/integration/helpers.ts).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // first listener: every log line, the exception filter and the response header carry this id
  app.use(requestIdMiddleware);
  configureBodyParsers(app);
  // SIGTERM/SIGINT run onModuleDestroy/onApplicationShutdown: drains the Redis connection and
  // stops the backup/upload timers instead of exiting mid-transfer.
  app.enableShutdownHooks();

  // ponytail: trust proxy 1 — a single reverse proxy in front; req.ip reads X-Forwarded-For
  // so per-IP rate limiting sees clients, not the proxy. Bump the hop count if proxies stack.
  app.set('trust proxy', 1);

  // ponytail: helmet not in the workspace — three static headers instead; no CSP on purpose
  // (would break the Vite-served SPA and Swagger UI)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // ponytail: no CORS — browsers reach the API same-origin via the Vite proxy / reverse proxy
  const config = new DocumentBuilder()
    .setTitle('Photox API')
    .setDescription('Photo hosting API')
    .setVersion('1.0')
    // Swagger UI can send the same Bearer access token the API accepts (cookie auth
    // works without this — the browser attaches it)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });

  await app.listen(env.API_PORT);
  console.log(`API running on port ${env.API_PORT}`);
}

void bootstrap();
