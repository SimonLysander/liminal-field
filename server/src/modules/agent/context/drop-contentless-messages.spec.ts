import { dropContentlessMessages } from './drop-contentless-messages';

const txt = (role: string, text: string) => ({
  role,
  parts: [{ type: 'text', text }],
});

describe('dropContentlessMessages', () => {
  it('丢弃 parts 为空的 assistant 消息(毒消息)', () => {
    const msgs = [
      txt('user', 'hi'),
      { role: 'assistant', parts: [] },
      txt('user', 'again'),
    ];
    expect(dropContentlessMessages(msgs)).toEqual([
      txt('user', 'hi'),
      txt('user', 'again'),
    ]);
  });

  it('丢弃仅 reasoning、无 text 的 assistant 消息', () => {
    const msgs = [
      txt('user', 'hi'),
      { role: 'assistant', parts: [{ type: 'reasoning', text: '想…' }] },
    ];
    expect(dropContentlessMessages(msgs)).toEqual([txt('user', 'hi')]);
  });

  it('保留含 tool 部件的 assistant 消息(无 text 也保留)', () => {
    const toolMsg = {
      role: 'assistant',
      parts: [
        { type: 'tool-web_search', state: 'output-available', output: '…' },
      ],
    };
    const msgs = [txt('user', 'q'), toolMsg];
    expect(dropContentlessMessages(msgs)).toEqual(msgs);
  });

  it('保留正常 text 消息;纯空白 text 视为无内容丢弃', () => {
    const msgs = [
      txt('user', 'hi'),
      txt('assistant', '答'),
      { role: 'assistant', parts: [{ type: 'text', text: '   ' }] },
    ];
    expect(dropContentlessMessages(msgs)).toEqual([
      txt('user', 'hi'),
      txt('assistant', '答'),
    ]);
  });

  it('空数组 → 空数组', () => {
    expect(dropContentlessMessages([])).toEqual([]);
  });
});
