import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'RAW_RESPONSE';

/**
 * 标记端点跳过全局响应包装（如直接发送文件流的端点）。
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
