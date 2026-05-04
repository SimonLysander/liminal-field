import { BadRequestException } from '@nestjs/common';

/**
 * commitHash 格式校验：7-64 位十六进制字符。
 * 覆盖 short hash（7位）和 full SHA-1/SHA-256（40/64位）等常见格式。
 * 不合法时抛 BadRequestException，调用方无需自行处理格式判断。
 */
export function validateCommitHash(hash: string): void {
  if (!/^[0-9a-f]{7,64}$/i.test(hash)) {
    throw new BadRequestException(
      `Invalid commitHash format: "${hash}". Expected 7-64 hex characters.`,
    );
  }
}
