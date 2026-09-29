import { Module } from '@nestjs/common'
import { loadRootEnvFile } from '@photox/shared-config'
import { HealthModule } from './health/health.module'
import { QueueModule } from './queue/queue.module'

// replicates @nestjs/config's envFilePath ['../../.env', '.env'] for host dev; compose/CI env wins
loadRootEnvFile()

@Module({
  imports: [QueueModule, HealthModule],
})
export class AppModule {}
