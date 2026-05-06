/**
 * 字符串 token，与 MinioModule 里 `useExisting: MinioService` 成对使用；
 * 避免 `new InjectionToken()` 在部分 ESLint program 下被标成 unresolved。
 */
export const MINIO_DRAFT_STORAGE = 'MINIO_DRAFT_STORAGE';
