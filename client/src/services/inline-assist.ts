import { ApiError, request } from './request';

export interface InlineAssistPayload {
  mode?: 'continue';
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
  let res: Response;
  try {
    res = await fetch('/api/v1/inline-assist/stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text) as { msg?: string; message?: string };
      message = json.msg || json.message || message;
    } catch {
      if (text) message = text;
    }
    throw new ApiError(res.status, message);
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
