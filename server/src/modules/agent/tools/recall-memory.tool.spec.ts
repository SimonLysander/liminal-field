/**
 * recall_memory + search_memories 工具单测(#150 配套, 2026-05-31)
 *
 * 契约对照 docs/agent-tools-redesign.md §3.10 / §3.11:
 * - summary 只放 TL;DR(不放全文/不放列表)
 * - detail 放主体(全文 / 候选列表)
 * - meta 给完整分页字段 + status,不静默丢
 * - session 类型挡回,防内部字段泄漏
 */
import type { AgentMemoryRepository } from '../memory/agent-memory.repository';
import type {
  AgentMemory,
  AgentMemoryType,
} from '../memory/agent-memory.entity';
import { createRecallMemoryTool } from './recall-memory.tool';
import { createSearchMemoriesTool } from './search-memories.tool';

interface ParsedResult {
  summary: string;
  detail?: string;
  meta?: {
    status?: string;
    total?: number;
    shown?: number;
    offset?: number;
    hasMore?: boolean;
    nextOffset?: number;
    memoryTitle?: string;
    type?: string;
    list?: string[];
  };
}
const parse = (s: unknown) => JSON.parse(s as string) as ParsedResult;

const mkMemory = (
  title: string,
  content: string,
  type: AgentMemoryType = 'user',
): AgentMemory =>
  ({
    _id: title,
    type,
    title,
    content,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as AgentMemory;

/**
 * fakeRepo:仅实现两个工具用到的两个方法,其余抛错——
 * "工具偷偷碰别的方法"的回归立刻冒出来。
 */
const mkRepo = (memories: AgentMemory[]): AgentMemoryRepository => {
  return {
    findByTitle: (title: string) =>
      Promise.resolve(memories.find((m) => m.title === title) ?? null),
    findByTypes: (types: AgentMemoryType[]) =>
      Promise.resolve(memories.filter((m) => types.includes(m.type))),
  } as unknown as AgentMemoryRepository;
};

describe('recall_memory tool (§3.10 契约)', () => {
  it('命中 user 记忆:summary 是 TL;DR,全文进 detail', async () => {
    const tool = createRecallMemoryTool(
      mkRepo([mkMemory('身份', '我是写作者')]),
    );
    const r = parse(await (tool as any).execute({ title: '身份' }));
    expect(r.meta?.status).toBe('ok');
    // summary 不含全文,只 TL;DR
    expect(r.summary).toBe('已读取「身份」· 5 字');
    expect(r.summary).not.toContain('我是写作者');
    // 全文进 detail
    expect(r.detail).toBe('我是写作者');
    // meta 带回 memoryTitle + type 供模型续用
    expect(r.meta?.memoryTitle).toBe('身份');
    expect(r.meta?.type).toBe('user');
  });

  it('title 不存在:not_found + 提示回看 <memories_index>', async () => {
    const tool = createRecallMemoryTool(mkRepo([mkMemory('A', 'a')]));
    const r = parse(await (tool as any).execute({ title: '不存在' }));
    expect(r.meta?.status).toBe('not_found');
    expect(r.detail).toBeUndefined();
    expect(r.summary).toMatch(/<memories_index>/);
  });

  it('session 类型挡回:即便 title 精确命中也 not_found,且 detail 不复述 content', async () => {
    const tool = createRecallMemoryTool(
      mkRepo([mkMemory('会话脉络', '内部 tasks/agentKey 字段', 'session')]),
    );
    const r = parse(await (tool as any).execute({ title: '会话脉络' }));
    expect(r.meta?.status).toBe('not_found');
    // 关键:防泄漏——内部字段不能出现在任何字段
    expect(r.summary).not.toContain('内部 tasks/agentKey');
    expect(r.detail).toBeUndefined();
  });

  it('title 前后空格 trim 后匹配', async () => {
    const tool = createRecallMemoryTool(
      mkRepo([mkMemory('身份', '我是写作者')]),
    );
    const r = parse(await (tool as any).execute({ title: '  身份  ' }));
    expect(r.meta?.status).toBe('ok');
  });
});

describe('search_memories tool (§3.11 契约)', () => {
  it('模糊匹配 title:summary TL;DR + detail 候选列表 + meta 分页字段', async () => {
    const tool = createSearchMemoriesTool(
      mkRepo([
        mkMemory('写作偏好', '简洁'),
        mkMemory('身份', '写作者'),
        mkMemory('饮食', '辣'),
      ]),
    );
    const r = parse(await (tool as any).execute({ query: '写作' }));
    expect(r.meta?.status).toBe('ok');
    // summary 是 TL;DR:头几个标题 + 总数
    expect(r.summary).toMatch(/命中 2 条/);
    // detail 是候选列表,每条一行
    expect(r.detail).toContain('- 写作偏好');
    expect(r.detail).toContain('- 身份');
    expect(r.detail).not.toContain('饮食');
    // meta 给完整分页字段
    expect(r.meta?.total).toBe(2);
    expect(r.meta?.shown).toBe(2);
    expect(r.meta?.offset).toBe(0);
    expect(r.meta?.hasMore).toBe(false);
    // meta.list 给前端 NestedList 渲染(与 search_knowledge_base 同约定)
    expect(r.meta?.list).toEqual(['写作偏好', '身份']);
  });

  it('模糊匹配 content:命中正文里的关键词,不只匹配标题', async () => {
    const tool = createSearchMemoriesTool(
      mkRepo([mkMemory('饮食偏好', '我喜欢辣的')]),
    );
    const r = parse(await (tool as any).execute({ query: '辣' }));
    expect(r.meta?.status).toBe('ok');
    expect(r.detail).toContain('- 饮食偏好');
  });

  it('截断:meta.hasMore + meta.nextOffset 让 agent 能续取(铁律 1 不静默丢)', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      mkMemory(`M${i}`, `提及关键词 K${i}`),
    );
    const tool = createSearchMemoriesTool(mkRepo(many));
    const r = parse(await (tool as any).execute({ query: '关键词' }));
    expect(r.meta?.total).toBe(15);
    expect(r.meta?.shown).toBe(10);
    expect(r.meta?.offset).toBe(0);
    expect(r.meta?.hasMore).toBe(true);
    expect(r.meta?.nextOffset).toBe(10);
    // detail 是前 10 条
    expect(r.detail).toContain('- M0');
    expect(r.detail).toContain('- M9');
    expect(r.detail).not.toContain('- M10');
  });

  it('用 offset 续取下一页', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      mkMemory(`M${i}`, `提及关键词 K${i}`),
    );
    const tool = createSearchMemoriesTool(mkRepo(many));
    // 第二页:offset 10
    const r = parse(
      await (tool as any).execute({ query: '关键词', offset: 10 }),
    );
    expect(r.meta?.total).toBe(15);
    expect(r.meta?.shown).toBe(5);
    expect(r.meta?.offset).toBe(10);
    expect(r.meta?.hasMore).toBe(false);
    expect(r.meta?.nextOffset).toBeUndefined();
    expect(r.detail).toContain('- M10');
    expect(r.detail).toContain('- M14');
    expect(r.detail).not.toContain('- M9');
  });

  it('自定义 limit', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      mkMemory(`M${i}`, `K${i}`),
    );
    const tool = createSearchMemoriesTool(mkRepo(many));
    const r = parse(await (tool as any).execute({ query: '', limit: 3 }));
    expect(r.meta?.shown).toBe(3);
    expect(r.meta?.hasMore).toBe(true);
    expect(r.meta?.nextOffset).toBe(3);
  });

  it('空结果:not_found + meta.total:0', async () => {
    const tool = createSearchMemoriesTool(
      mkRepo([mkMemory('A', 'aaa'), mkMemory('B', 'bbb')]),
    );
    const r = parse(await (tool as any).execute({ query: '不存在的词' }));
    expect(r.meta?.status).toBe('not_found');
    expect(r.meta?.total).toBe(0);
    expect(r.detail).toBeUndefined();
  });

  it('空 query:列全部 user 记忆(可用于"看看都有啥")', async () => {
    const tool = createSearchMemoriesTool(
      mkRepo([mkMemory('A', 'aaa'), mkMemory('B', 'bbb')]),
    );
    const r = parse(await (tool as any).execute({ query: '' }));
    expect(r.meta?.status).toBe('ok');
    expect(r.summary).toMatch(/共 2 条/);
  });

  it('不搜 session 类型:即便文字命中也不返(防内部字段泄漏)', async () => {
    const tool = createSearchMemoriesTool(
      mkRepo([
        mkMemory('user-记忆', '关于写作', 'user'),
        mkMemory('session-脉络', '关于写作', 'session'),
      ]),
    );
    const r = parse(await (tool as any).execute({ query: '写作' }));
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.total).toBe(1);
    expect(r.detail).toContain('- user-记忆');
    expect(r.detail).not.toContain('session-脉络');
  });

  it('limit 上限保护:超过 MAX_LIMIT 也被夹住', async () => {
    const many = Array.from({ length: 100 }, (_, i) => mkMemory(`M${i}`, ''));
    const tool = createSearchMemoriesTool(mkRepo(many));
    const r = parse(await (tool as any).execute({ query: '', limit: 9999 }));
    // MAX_LIMIT = 50
    expect(r.meta?.shown).toBe(50);
    expect(r.meta?.hasMore).toBe(true);
  });
});
