import type { DocumentContext } from '../tools/get-current-document.tool';

const DEFAULT_RECENT_CONTEXT_CHARS = 12_000;

export interface SubAgentParentContext {
  currentUserRequest?: string;
  recentConversation?: string;
  sessionSummary?: string;
  sceneContext?: string;
  document?: DocumentContext;
  learningTopicId?: string;
  learningNoteId?: string;
}

/** 只提取用户可见文本，避免把工具结果、审批载荷和模型内部状态转交给子 agent。 */
export function extractUiMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';

  const record = message as Record<string, unknown>;
  if (typeof record.content === 'string') return record.content.trim();
  if (!Array.isArray(record.parts)) return '';

  return record.parts
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return [];
      const candidate = part as Record<string, unknown>;
      return candidate.type === 'text' && typeof candidate.text === 'string'
        ? [candidate.text]
        : [];
    })
    .join('\n')
    .trim();
}

/**
 * 最近对话按完整消息从新到旧纳入预算，再恢复为时间正序。
 * 这比直接截字符串更不容易从一句话中间切断语义。
 */
export function formatRecentConversation(
  messages: Record<string, unknown>[],
  maxChars: number = DEFAULT_RECENT_CONTEXT_CHARS,
): string {
  const entries = messages.flatMap((message) => {
    const text = extractUiMessageText(message);
    if (!text) return [];

    const role =
      message.role === 'user'
        ? '用户'
        : message.role === 'assistant'
          ? '主智能体'
          : null;
    return role ? [`${role}：${text}`] : [];
  });

  const selected: string[] = [];
  let chars = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    const added = entry.length + (selected.length > 0 ? 2 : 0);
    if (chars + added > maxChars) break;
    selected.unshift(entry);
    chars += added;
  }

  // 单条最新消息超过预算时仍保留其尾部，避免近期上下文整体变成空白。
  if (selected.length === 0 && entries.length > 0 && maxChars > 1) {
    selected.push(`…${entries.at(-1)?.slice(-(maxChars - 1))}`);
  }

  const prefix =
    selected.length < entries.length ? '（较早对话已省略）\n\n' : '';
  return `${prefix}${selected.join('\n\n')}`;
}

/**
 * 上下文在前、委派焦点在后。委派焦点是本轮研究重心，不替代用户目标和业务现场。
 */
export function buildSubAgentPrompt(
  task: string,
  context: SubAgentParentContext,
): string {
  const contextSections = [
    context.currentUserRequest
      ? `### 当前用户请求\n${context.currentUserRequest}`
      : '',
    context.recentConversation
      ? `### 最近对话\n${context.recentConversation}`
      : '',
    context.sessionSummary ? `### 会话脉络摘要\n${context.sessionSummary}` : '',
    context.sceneContext ? `### 当前业务场景\n${context.sceneContext}` : '',
    context.document
      ? `### 当前文档\n标题：${context.document.title}\n内容 ID：${context.document.contentItemId}`
      : '',
    context.learningTopicId
      ? `### 学习主题 ID\n${context.learningTopicId}`
      : '',
    context.learningNoteId
      ? `### 当前学习节点 ID\n${context.learningNoteId}`
      : '',
  ].filter(Boolean);

  return [
    '# 父任务上下文',
    contextSections.length > 0
      ? contextSections.join('\n\n')
      : '当前没有额外上下文。',
    '# 本次委派焦点',
    task.trim(),
  ].join('\n\n');
}
