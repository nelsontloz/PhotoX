import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { BullMqService } from './bullmq.service'
import { FaceClusterService } from './face.cluster'

interface ClusterJob {
  userId: string
  reason?: 'face-detected' | 'manual'
}

@Injectable()
export class FaceClusterProcessor {
  private readonly logger = new Logger(FaceClusterProcessor.name)

  constructor(
    private readonly bullMq: BullMqService,
    private readonly faceCluster: FaceClusterService,
  ) {}

  start() {
    this.bullMq.createWorker<ClusterJob>(
      'process-faces-cluster',
      (job) => this.processJob(job),
      { concurrency: 1 },
    )

    this.logger.log('Face cluster processor listening for jobs')
  }

  private async processJob(job: Job<ClusterJob>) {
    const { userId, reason } = job.data

    this.logger.log(`Clustering faces: user=${userId}, reason=${reason ?? 'unknown'}`)

    await this.faceCluster.cluster(userId)

    this.logger.log(`Clustering complete: user=${userId}`)
  }
}
