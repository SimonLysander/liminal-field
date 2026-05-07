import { Module, Global } from '@nestjs/common';
import { OssService } from './oss.service';
import { MINIO_DRAFT_STORAGE } from '../minio/minio-draft-storage.token';

/**
 * OssModule — 全局模块，替代 MinioModule。
 *
 * 重用 MINIO_DRAFT_STORAGE token（字符串常量），保持与 StartupDiagnosticsService
 * 注入点的兼容性，无需改动注入侧代码。
 */
@Global()
@Module({
  providers: [
    OssService,
    { provide: MINIO_DRAFT_STORAGE, useExisting: OssService },
  ],
  exports: [OssService, MINIO_DRAFT_STORAGE],
})
export class OssModule {}
