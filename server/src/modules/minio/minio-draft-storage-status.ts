/**
 * 草稿桶连通性快照（仅方法签名），供 StartupDiagnostics 等消费方使用。
 * 单独文件、不 import `minio`，避免 ESLint/TS program 在部分工作区根目录解析 packages 时把依赖方标成 error。
 */
export interface MinioDraftStorageStatus {
  isDraftStorageReady(): boolean;
  getDraftStorageConfig(): {
    endpoint: string;
    port: number;
    bucket: string;
    useSSL: boolean;
  };
  getDraftStorageInitError(): string | null;
}
