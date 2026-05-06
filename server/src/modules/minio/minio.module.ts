import { Module, Global } from '@nestjs/common';
import { MinioService } from './minio.service';
import { MINIO_DRAFT_STORAGE } from './minio-draft-storage.token';

@Global()
@Module({
  providers: [
    MinioService,
    { provide: MINIO_DRAFT_STORAGE, useExisting: MinioService },
  ],
  exports: [MinioService, MINIO_DRAFT_STORAGE],
})
export class MinioModule {}
