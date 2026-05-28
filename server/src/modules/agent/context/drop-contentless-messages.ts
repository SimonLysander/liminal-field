/**
 * dropContentlessMessages — 丢弃「无可转成 ModelMessage 内容」的消息。
 *
 * 背景(踩坑):模型偶尔产出空 assistant 消息(parts:[],或仅 reasoning 无 text),
 * onFinish 会把它持久化进 agent_sessions。下一轮读历史时 convertToModelMessages
 * 撞上这种空消息 → 抛 "messages do not match ModelMessage[] schema",整段对话从此
 * 每轮必崩(一条毒消息毒死整个会话)。
 *
 * 策略:
 * - 读侧(喂模型前):丢弃毒消息,既 un-brick 已存在毒消息的会话,也防止喂坏 prompt。
 * - 写侧(持久化前):从本轮增量里丢弃空 assistant,防止毒消息进库累积。
 *
 * 判定「有内容」:存在非空 text 部件,或存在 tool 部件(tool-call-only 的 assistant
 * 合法且必要,要保留)。仅 reasoning / parts 为空 → 视为无内容,丢弃。
 * user 消息恒有 text 部件,不受影响。
 */
export function dropContentlessMessages<T extends Record<string, unknown>>(
  messages: T[],
): T[] {
  return messages.filter((msg) => {
    const parts = msg.parts as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(parts) || parts.length === 0) return false;
    return parts.some((part) => {
      const type = part.type as string | undefined;
      if (typeof type !== 'string') return false;
      if (type === 'text') {
        return typeof part.text === 'string' && part.text.trim().length > 0;
      }
      // 工具部件(含 sanitize 后的 output-error)保留
      return type.startsWith('tool-') || type === 'dynamic-tool';
    });
  });
}
