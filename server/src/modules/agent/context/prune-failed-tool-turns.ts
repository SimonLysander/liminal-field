/**
 * 失败工具调用需要保留在会话存储中供界面展示和排障，但不应永久进入后续模型上下文。
 * 否则模型会反复模仿自己曾经生成的空参数或坏 JSON，使一次失败污染整个长会话。
 */
import { readToolResultStatus } from '../agent.utils';
import { ABORT_ERROR_TEXT } from './sanitize-aborted-tool-calls';

function isToolPart(part: Record<string, unknown>): boolean {
  const type = part['type'];
  return (
    typeof type === 'string' &&
    (type.startsWith('tool-') || type === 'dynamic-tool')
  );
}

function isFailedToolPart(part: Record<string, unknown>): boolean {
  if (!isToolPart(part)) return false;
  if (
    part['state'] === 'output-available' &&
    readToolResultStatus(part['output']) === 'invalid'
  ) {
    return true;
  }
  if (part['state'] !== 'output-error') return false;
  const errorText = part['errorText'];
  if (typeof errorText !== 'string') return false;
  return (
    errorText === ABORT_ERROR_TEXT ||
    /invalid (?:input|tool input)|参数(?:解析|校验|无效)|does not match the schema|json (?:parse|parsing)/i.test(
      errorText,
    )
  );
}

/**
 * 纯失败工具轮次整体丢弃；混合轮次只剔除失败工具部件，保留成功调用和正常文本。
 * 返回新对象，不修改数据库读出的消息。
 */
export function pruneFailedToolTurns<T extends Record<string, unknown>>(
  messages: T[],
): T[] {
  return messages.map((message) => {
    if (message['role'] !== 'assistant') return message;
    const parts = message['parts'];
    if (!Array.isArray(parts)) return message;

    const records = parts as Array<Record<string, unknown>>;
    const toolParts = records.filter(isToolPart);
    if (toolParts.length === 0) return message;

    const successfulToolParts = toolParts.filter(
      (part) => !isFailedToolPart(part),
    );
    if (successfulToolParts.length === 0) {
      return { ...message, parts: [] };
    }

    const filtered = records.filter((part) => !isFailedToolPart(part));
    return filtered.length === records.length
      ? message
      : { ...message, parts: filtered };
  });
}
