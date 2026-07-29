import {
  buildSubAgentPrompt,
  extractUiMessageText,
  formatRecentConversation,
} from '../sub-agent-context';

describe('sub-agent context', () => {
  it('extracts only visible text parts from UI messages', () => {
    expect(
      extractUiMessageText({
        role: 'user',
        parts: [
          { type: 'text', text: '先研究背景' },
          { type: 'tool-call', output: '内部工具载荷' },
          { type: 'text', text: '再比较差异' },
        ],
      }),
    ).toBe('先研究背景\n再比较差异');
  });

  it('keeps recent user and assistant messages in chronological order', () => {
    const conversation = formatRecentConversation([
      { role: 'system', content: '内部提示词' },
      { role: 'user', parts: [{ type: 'text', text: '第一问' }] },
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: '第一答' },
          { type: 'tool-result', output: '不可见结果' },
        ],
      },
    ]);

    expect(conversation).toBe('用户：第一问\n\n主智能体：第一答');
    expect(conversation).not.toContain('内部提示词');
    expect(conversation).not.toContain('不可见结果');
  });

  it('drops complete older messages when the character budget is exceeded', () => {
    const conversation = formatRecentConversation(
      [
        { role: 'user', content: '较早消息' },
        { role: 'assistant', content: '最新消息' },
      ],
      12,
    );

    expect(conversation).toContain('较早对话已省略');
    expect(conversation).toContain('主智能体：最新消息');
    expect(conversation).not.toContain('较早消息');
  });

  it('retains the tail of an oversized latest message', () => {
    const conversation = formatRecentConversation(
      [{ role: 'user', content: '这是一条超过预算的最新消息' }],
      8,
    );

    expect(conversation).toMatch(/^…/);
    expect(conversation).toContain('最新消息');
  });

  it('places inherited context before the delegated focus without embedding the draft body', () => {
    const prompt = buildSubAgentPrompt('核对关键结论', {
      currentUserRequest: '帮我审查这一节',
      recentConversation: '用户：先看论据',
      sceneContext: '当前为学习写作页',
      document: {
        contentItemId: 'note-1',
        title: '波动率',
        bodyMarkdown: '不应直接塞入子 agent 提示词的长正文',
      },
      learningNoteId: 'note-1',
    });

    expect(prompt.indexOf('# 父任务上下文')).toBeLessThan(
      prompt.indexOf('# 本次委派焦点'),
    );
    expect(prompt).toContain('帮我审查这一节');
    expect(prompt).toContain('核对关键结论');
    expect(prompt).toContain('标题：波动率');
    expect(prompt).not.toContain('不应直接塞入');
  });
});
