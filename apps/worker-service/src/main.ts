import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { killLiveChildren } from './queue/ffmpeg';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // without shutdown hooks BullMqService.onModuleDestroy never runs, so workers and Redis stay open
  app.enableShutdownHooks();

  // Nest's shutdown waits for active jobs; a 1h encode would keep the process alive, so SIGKILL the
  // ffmpeg children first and let the job fail fast. Registered after the hooks: Nest's own handler
  // starts the async close, then this one runs while it awaits.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => killLiveChildren());
  }

  const port = Number(process.env.WORKER_SERVICE_PORT) || 3004;
  await app.listen(port);
  console.log(`Worker Service running on port ${port}`);
}

void bootstrap();
