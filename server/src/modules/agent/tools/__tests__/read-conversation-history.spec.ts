/**
 * read_conversation_history 工具单测。
 *
 * 覆盖场景：
 * 1. 无关键词：返回全部消息（受 limit 约束，取最近 N 条）
 * 2. 有关键词：过滤后取最近 N 条
 * 3. 无匹配关键词：返回空，hasMore=false
 * 4. limit 默认值 50 生效：总量 < 50 时返回全部，不截断
 * 5. hasMore 正确：过滤后 > limit 时 hasMore=true
 * 6. 正序保持：旧消息排前（索引小的先返回）
 */
import { createReadConversationHistoryTool } from '../read-conversation-history.tool';

// execute 第二参(options)我们的工具用不到,测试里给个空对象
const RUN = {} as never;

type Parsed = {
  summary: string;
  detail?: string;
  meta?: Record<string, unknown>;
};
const parse = (raw: string): Parsed => JSON.parse(raw) as Parsed;

function mkMsg(role: string, content: string) {
  return { role, content };
}

describe('read_conversation_history', () => {
  it('无关键词 + limit=3：返回最近 3 条，正序', async () => {
    const msgs = [
      mkMsg('user', 'a'),
      mkMsg('assistant', 'b'),
      mkMsg('user', 'c'),
      mkMsg('assistant', 'd'),
      mkMsg('user', 'e'),
    ];
    const repo = { getAllMessages: jest.fn().mockResolvedValue(msgs) };
    const tool = createReadConversationHistoryTool(repo as never, 'agent1');

    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({ limit: 3 }, RUN),
    );

    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.shown).toBe(3);
    expect(r.meta?.total).toBe(5);
    expect(r.meta?.hasMore).toBe(true);

    // detail 是 JSON 字符串的消息数组，最近 3 条
    const detail = JSON.parse(r.detail ?? '[]') as typeof msgs;
    expect(detail).toHaveLength(3);
    expect(detail[0].content).toBe('c');
    expect(detail[2].content).toBe('e');
  });

  it('有关键词：只返回含关键词的消息', async () => {
    const msgs = [
      mkMsg('user', '今天天气不错'),
      mkMsg('assistant', '是的，天气很好'),
      mkMsg('user', '帮我写一首关于天气的诗'),
      mkMsg('assistant', '春风拂面暖……'),
    ];
    const repo = { getAllMessages: jest.fn().mockResolvedValue(msgs) };
    const tool = createReadConversationHistoryTool(repo as never, 'agent2');

    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({ keyword: '天气' }, RUN),
    );

    expect(r.meta?.total).toBe(3); // 3 条含"天气"：msg0/msg1/msg2
    expect(r.meta?.shown).toBe(3);
    expect(r.summary).toContain('天气');
    expect(r.meta?.hasMore).toBe(false);
  });

  it('无匹配关键词：total=0，hasMore=false', async () => {
    const msgs = [mkMsg('user', 'hello'), mkMsg('assistant', 'hi')];
    const repo = { getAllMessages: jest.fn().mockResolvedValue(msgs) };
    const tool = createReadConversationHistoryTool(repo as never, 'agent3');

    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({ keyword: '量子纠缠' }, RUN),
    );

    expect(r.meta?.total).toBe(0);
    expect(r.meta?.shown).toBe(0);
    expect(r.meta?.hasMore).toBe(false);
  });

  it('消息总量 < 默认 limit(50)：返回全部，hasMore=false', async () => {
    const msgs = Array.from({ length: 10 }, (_, i) => mkMsg('user', `msg${i}`));
    const repo = { getAllMessages: jest.fn().mockResolvedValue(msgs) };
    const tool = createReadConversationHistoryTool(repo as never, 'agent4');

    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({}, RUN),
    );

    expect(r.meta?.shown).toBe(10);
    expect(r.meta?.hasMore).toBe(false);
  });

  it('空对话：total=0，返回空 detail', async () => {
    const repo = { getAllMessages: jest.fn().mockResolvedValue([]) };
    const tool = createReadConversationHistoryTool(repo as never, 'agent5');

    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({}, RUN),
    );

    expect(r.meta?.total).toBe(0);
    expect(JSON.parse(r.detail ?? '[]')).toHaveLength(0);
  });
});
