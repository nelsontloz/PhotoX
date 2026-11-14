import { Injectable, Logger } from '@nestjs/common';
import { S3BackupService as S3BackupStore } from '@photox/shared-config';

// The S3 operator lives in shared-config so the worker's backup/restore transfers use the same
// client, MPU/GET restart semantics and bucket config as core. This subclass only gives Nest a
// zero-arg, logger-wired provider (the base class is framework-free).
@Injectable()
export class S3BackupService extends S3BackupStore {
  constructor() {
    super(new Logger(S3BackupService.name));
  }
}

export { isNotFound } from '@photox/shared-config';
