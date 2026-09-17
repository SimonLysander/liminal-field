interface PiToolResultLike {
  content?: Array<{ type?: string; text?: string; mimeType?: string }>;
  details?: unknown;
  isError?: boolean;
}

/** 读取适配器保留的原始工具输出；非适配结果退回文本内容。 */
export function readPiToolOutput(result: unknown): unknown {
  const value = result as PiToolResultLike | undefined;
  if (
    value?.details != null &&
    typeof value.details === 'object' &&
    'output' in value.details
  ) {
    return (value.details as { output?: unknown }).output;
  }
  return readPiToolResultText(result);
}

export function readPiToolResultText(result: unknown): string {
  const value = result as PiToolResultLike | undefined;
  const text = (value?.content ?? [])
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part.type === 'text' && typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('\n');
  if (text) return text;
  return (value?.content ?? [])
    .filter((part) => part.type === 'image')
    .map((part) => `[image:${part.mimeType ?? 'unknown'}]`)
    .join('\n');
}

/** 只识别参数 Schema 失败或业务 status=invalid；普通执行异常不计入参数纠错上限。 */
export function isPiToolResultInvalid(result: unknown): boolean {
  const value = result as PiToolResultLike | undefined;
  if (
    value?.isError &&
    readPiToolResultText(result).startsWith('Validation failed for tool "')
  ) {
    return true;
  }
  const output = readPiToolOutput(result);
  try {
    const parsed: unknown =
      typeof output === 'string' ? (JSON.parse(output) as unknown) : output;
    return (
      parsed != null &&
      typeof parsed === 'object' &&
      (parsed as { meta?: { status?: string } }).meta?.status === 'invalid'
    );
  } catch {
    return false;
  }
}
