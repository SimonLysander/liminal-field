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
 * 顺序式：readComposerPayload 遍历 AST,把 chip 在其所在位置原地展开成「内容」,
 * 返回 { text, references }：text 里引用就嵌在用户指代它的地方(给模型按位置读);
 * references 按序冻结发送瞬间的内容/标签,随消息持久化,供气泡把「content」渲染回 chip。
 */
describe('readComposerPayload', () => {
  it('freezes reference text at send time and expands it inline at the chip position', () => {
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

    // 顺序式:chip 在 AST 里原地展开成「发送瞬间的内容」,紧跟用户文字(位置即语义)
    expect(payload.text).toContain('润色这段「发送这一刻的最新正文」');
    // references 随消息走(供气泡渲染回 chip),内容按发送瞬间冻结
    expect(payload.references).toHaveLength(1);
    expect(payload.references[0].content).toBe('发送这一刻的最新正文');
  });

  it('expands multiple chips inline, preserving their positions in the text', () => {
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
    // 顺序式:chip 嵌在文字之间,展开后按位置保序(模型读到引用就在指代词旁)
    const nodes = [
      {
        type: 'p',
        children: [
          { text: '帮我看看 ' },
          { type: 'chat_reference', refId: 'ref-a', children: [{ text: '' }] },
          { text: ' 和 ' },
          { type: 'chat_reference', refId: 'ref-b', children: [{ text: '' }] },
        ],
      },
    ] as Descendant[];

    const payload = readComposerPayload(nodes, [sel1, sel2]);

    expect(payload.text).toContain(
      '帮我看看 「第一段发送时文本」 和 「第二段发送时文本」',
    );
  });
});
