import { ApiError, request } from './request';

export interface InlineAssistPayload {
  documentMarkdown?: string;
  beforeText?: string;
  selectedText?: string;
  afterText?: string;
  instruction?: string;
  documentTitle?: string;
  scope?: string;
}

export interface InlineAssistResult {
  markdown: string;
}

const INLINE_ASSIST_CURSOR_MARKER = '<!-- INLINE_ASSIST_CURSOR -->';
const INLINE_ASSIST_SELECTION_START_MARKER =
  '<!-- INLINE_ASSIST_SELECTION_START -->';
const INLINE_ASSIST_SELECTION_END_MARKER =
  '<!-- INLINE_ASSIST_SELECTION_END -->';

function getResponseMessage(text: string, status: number) {
  let message = `HTTP ${status}`;
  try {
    const json = JSON.parse(text) as { msg?: unknown; message?: unknown };
    const rawMessage = json.msg ?? json.message;
    if (Array.isArray(rawMessage)) {
      message = rawMessage.map(String).join('\n');
    } else if (typeof rawMessage === 'string') {
      message = rawMessage;
    }
  } catch {
    if (text) message = text;
  }
  return message;
}

function isDocumentMarkdownWhitelistError(message: string) {
  return message.includes('property documentMarkdown should not exist');
}

function toLegacyInlineAssistPayload(
  payload: InlineAssistPayload,
): InlineAssistPayload {
  if (!payload.documentMarkdown) return payload;

  const { documentMarkdown, ...legacyPayload } = payload;
  const selectionStart = documentMarkdown.indexOf(
    INLINE_ASSIST_SELECTION_START_MARKER,
  );
  const selectionEnd = documentMarkdown.indexOf(INLINE_ASSIST_SELECTION_END_MARKER);
  if (selectionStart >= 0 && selectionEnd > selectionStart) {
    return {
      ...legacyPayload,
      beforeText:
        legacyPayload.beforeText ??
        documentMarkdown.slice(0, selectionStart),
      selectedText:
        legacyPayload.selectedText ||
        documentMarkdown.slice(
          selectionStart + INLINE_ASSIST_SELECTION_START_MARKER.length,
          selectionEnd,
        ),
      afterText:
        legacyPayload.afterText ??
        documentMarkdown.slice(
          selectionEnd + INLINE_ASSIST_SELECTION_END_MARKER.length,
        ),
    };
  }

  const cursor = documentMarkdown.indexOf(INLINE_ASSIST_CURSOR_MARKER);
  if (cursor >= 0) {
    return {
      ...legacyPayload,
      beforeText: legacyPayload.beforeText ?? documentMarkdown.slice(0, cursor),
      afterText:
        legacyPayload.afterText ??
        documentMarkdown.slice(cursor + INLINE_ASSIST_CURSOR_MARKER.length),
    };
  }

  return {
    ...legacyPayload,
    beforeText: legacyPayload.beforeText ?? documentMarkdown,
  };
}

export function inlineAssist(
  payload: InlineAssistPayload,
  signal?: AbortSignal,
) {
  return request<InlineAssistResult>('/inline-assist', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function streamInlineAssist(
  payload: InlineAssistPayload,
  {
    onChunk,
    signal,
  }: {
    onChunk: (chunk: string) => void;
    signal?: AbortSignal;
  },
) {
  const send = async (body: InlineAssistPayload) => {
    try {
      return await fetch('/api/v1/inline-assist/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }

      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      throw new ApiError(
        0,
        offline ? '已离线，无法生成' : '网络请求失败，请稍后重试',
      );
    }
  };

  let res = await send(payload);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const message = getResponseMessage(text, res.status);

    if (payload.documentMarkdown && isDocumentMarkdownWhitelistError(message)) {
      // 兼容已加载新前端、后端进程仍是旧 DTO 的短暂混跑窗口。
      res = await send(toLegacyInlineAssistPayload(payload));
    } else {
      throw new ApiError(res.status, message);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, getResponseMessage(text, res.status));
  }

  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
  const rest = decoder.decode();
  if (rest) onChunk(rest);
}
