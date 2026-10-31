import { Global, Module } from '@nestjs/common';
import { BullMqService } from './bullmq.service';

@Global()
@Module({
  providers: [BullMqService],
  exports: [BullMqService],
})
export class BullMqModule {}
