import { describe, expect, it } from 'vitest';
import type { Descendant } from 'platejs';
import type { ChatSelectionAttachment } from '@/pages/admin/lib/live-chat-selection';
import { readComposerPayload } from './AiReferenceComposer';
import { toAdvisorSendText } from './advisor-send-text';

describe('toAdvisorSendText', () => {
  it('does not inline selected text into the user message', () => {
    expect(
      toAdvisorSendText(' 请基于这段话判断语气 '),
    ).toBe('请基于这段话判断语气');
  });

  it('trims empty input to an empty message', () => {
    expect(toAdvisorSendText('   ')).toBe('');
  });
});

/**
 * v3 协议：readComposerPayload 把 chips 引用拼成 markdown > 引用块，
 * 只返回 { text }，不再返回 references 数组。
 *
 * chips 是用户显式圈出的注意力锚点，通过 getText() 读发送瞬间的 live 文本，
 * 拼成 `> 第N段：「...」` 追加到正文末尾。
 */
describe('readComposerPayload', () => {
  it('freezes reference text at send time and appends as markdown blockquote', () => {
    let liveText = '添加 chip 之后改过的正文';
    const selection: ChatSelectionAttachment = {
      id: 'ref-1',
      preview: '添加 chip 时的旧正文',
      getText: () => liveText,
      getAnchor: () => ({
        type: 'range',
        blockIndex: 15,
        startPath: [15, 0],
        endPath: [16, 0],
      }),
      highlight: () => true,
      clearHighlight: () => undefined,
      dispose: () => undefined,
    };
    const nodes = [
      {
        type: 'p',
        children: [
          { text: '润色这段' },
          { type: 'chat_reference', refId: 'ref-1', children: [{ text: '' }] },
        ],
      },
    ] as Descendant[];

    liveText = '发送这一刻的最新正文';

    const payload = readComposerPayload(nodes, [selection]);

    // v3：chips 不再展开为 [片段 N]，而是拼成 > 引用块追加到 text 末尾
    expect(payload.text).toContain('润色这段');
    expect(payload.text).toContain('> 第 16 段：「发送这一刻的最新正文」');
    // v3：不再有 references 字段
    expect(payload).not.toHaveProperty('references');
  });

  it('appends multiple chips as separate blockquote lines', () => {
    const sel1: ChatSelectionAttachment = {
      id: 'ref-a',
      preview: '第一段预览',
      getText: () => '第一段发送时文本',
      getAnchor: () => ({ type: 'range', blockIndex: 0, startPath: [0, 0], endPath: [0, 0] }),
      highlight: () => true,
      clearHighlight: () => undefined,
      dispose: () => undefined,
    };
    const sel2: ChatSelectionAttachment = {
      id: 'ref-b',
      preview: '第二段预览',
      getText: () => '第二段发送时文本',
      getAnchor: () => ({ type: 'range', blockIndex: 2, startPath: [2, 0], endPath: [2, 0] }),
      highlight: () => true,
      clearHighlight: () => undefined,
      dispose: () => undefined,
    };
    const nodes = [{ type: 'p', children: [{ text: '帮我看看这两段' }] }] as Descendant[];

    const payload = readComposerPayload(nodes, [sel1, sel2]);

    expect(payload.text).toContain('> 第 1 段：「第一段发送时文本」');
    expect(payload.text).toContain('> 第 3 段：「第二段发送时文本」');
  });
});
