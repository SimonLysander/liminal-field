/**
 * recall_memory + search_memories(2026-05-30 event log 重设)单测。
 *
 * 契约对照 docs/agent-tools-redesign.md §3.10 / §3.11 + spec memory-event-log:
 * - recall_memory:按 topic 深读最近 N 条 observation(时间序列)
 * - search_memories:跨主题关键词模糊搜 observations(+ 可选 topic 过滤)
 * - 都符合 ToolResult §1 契约:summary TL;DR + detail 主体 + meta 分页字段 + list 字段
 */
import type { AgentMemoryObservationRepository } from '../memory/agent-memory-observation.repository';
import type {
  AgentMemoryObservation,
  ObservationTopic,
} from '../memory/agent-memory-observation.entity';
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
    topic?: string;
    list?: string[];
  };
}
const parse = (s: unknown) => JSON.parse(s as string) as ParsedResult;

const mkObs = (
  topic: ObservationTopic,
  observation: string,
  observedAt: string, // YYYY-MM-DD
  context?: string,
): AgentMemoryObservation =>
  ({
    _id: `${topic}-${observedAt}-${Math.random()}`,
    topic,
    observation,
    observedAt: new Date(observedAt),
    context,
  }) as unknown as AgentMemoryObservation;

/**
 * fakeRepo:仅实现 recall/search 工具用到的两个方法,其余抛错(防回归)。
 * findRecent / findRecentByTopic 都返"按 observedAt 倒序"的数组——这是 repo 真实合约。
 */
const mkRepo = (
  observations: AgentMemoryObservation[],
): AgentMemoryObservationRepository => {
  const sorted = [...observations].sort(
    (a, b) =>
      new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
  );
  return {
    findRecent: (limit: number = 100) =>
      Promise.resolve(sorted.slice(0, limit)),
    findRecentByTopic: (topic: ObservationTopic, limit: number = 50) =>
      Promise.resolve(sorted.filter((o) => o.topic === topic).slice(0, limit)),
  } as unknown as AgentMemoryObservationRepository;
};

describe('recall_memory tool (event log 重设)', () => {
  it('topic 命中 → 时间序列正序(早→晚)输出', async () => {
    const tool = createRecallMemoryTool(
      mkRepo([
        mkObs('aesthetic', '散文偏简洁', '2026-01-10'),
        mkObs('aesthetic', '摄影偏黑白', '2026-03-15'),
        mkObs('aesthetic', '代码偏极简注释', '2026-05-01'),
        mkObs('method', '晨写', '2026-02-01'),
      ]),
    );
    const r = parse(await (tool as any).execute({ topic: 'aesthetic' }));
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.topic).toBe('aesthetic');
    expect(r.meta?.total).toBe(3);
    // detail 按时间正序(早→晚),让模型看到轨迹
    expect(r.detail).toMatch(
      /2026-01-10.*散文偏简洁[\s\S]*2026-03-15.*黑白[\s\S]*2026-05-01.*极简/,
    );
    // summary 含范围
    expect(r.summary).toMatch(/审美.*3 条.*横跨/);
    expect(r.summary).toContain('2026-01-10');
    expect(r.summary).toContain('2026-05-01');
    // method topic 的观察被排除
    expect(r.detail).not.toContain('晨写');
  });

  it('topic 暂无观察 → not_found + 空 detail', async () => {
    const tool = createRecallMemoryTool(
      mkRepo([mkObs('aesthetic', '简洁', '2026-05-01')]),
    );
    const r = parse(await (tool as any).execute({ topic: 'personality' }));
    expect(r.meta?.status).toBe('not_found');
    expect(r.meta?.total).toBe(0);
    expect(r.detail).toBeUndefined();
    expect(r.summary).toMatch(/性格/);
  });

  it('单条 observation → summary 不写"横跨"', async () => {
    const tool = createRecallMemoryTool(
      mkRepo([mkObs('identity', '在杭州', '2026-05-01')]),
    );
    const r = parse(await (tool as any).execute({ topic: 'identity' }));
    expect(r.meta?.status).toBe('ok');
    expect(r.summary).toMatch(/身份.*1 条/);
    expect(r.summary).not.toContain('横跨');
  });

  it('limit 上限保护 + context 字段渲染', async () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      mkObs('method', `观察${i}`, `2026-01-${(i % 28) + 1}`, '聊学习时'),
    );
    const tool = createRecallMemoryTool(mkRepo(many));
    const r = parse(
      await (tool as any).execute({ topic: 'method', limit: 9999 }),
    );
    // MAX_LIMIT = 100
    expect(r.meta?.shown).toBe(100);
    // context 渲染
    expect(r.detail).toContain('⟨聊学习时⟩');
  });

  it('非法 topic 返 invalid', async () => {
    const tool = createRecallMemoryTool(mkRepo([]));
    const r = parse(await (tool as any).execute({ topic: 'wuwu' }));
    expect(r.meta?.status).toBe('invalid');
  });
});

describe('search_memories tool (event log 重设)', () => {
  it('跨主题关键词搜:命中 + meta 完整 + list 给前端 NestedList', async () => {
    const tool = createSearchMemoriesTool(
      mkRepo([
        mkObs('aesthetic', '偏黑白纪实', '2026-05-01', '聊摄影时'),
        mkObs('method', '用尼康 Z5 拍照', '2026-03-15'),
        mkObs('identity', '在杭州', '2026-02-01'),
      ]),
    );
    const r = parse(await (tool as any).execute({ query: '摄影' }));
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.total).toBe(1); // 只 context "聊摄影时" 命中
    expect(r.detail).toContain('[aesthetic]');
    expect(r.detail).toContain('偏黑白纪实');
    expect(r.meta?.list).toHaveLength(1);
  });

  it('content 字段命中(不只 context)', async () => {
    const tool = createSearchMemoriesTool(
      mkRepo([mkObs('method', '用尼康 Z5 拍照', '2026-03-15')]),
    );
    const r = parse(await (tool as any).execute({ query: '尼康' }));
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.total).toBe(1);
    expect(r.detail).toContain('尼康');
  });

  it('topic 过滤生效', async () => {
    const tool = createSearchMemoriesTool(
      mkRepo([
        mkObs('aesthetic', '黑白', '2026-05-01'),
        mkObs('method', '黑白', '2026-05-02'),
      ]),
    );
    const r = parse(
      await (tool as any).execute({ query: '黑白', topic: 'aesthetic' }),
    );
    expect(r.meta?.total).toBe(1);
    expect(r.detail).toContain('[aesthetic]');
  });

  it('截断:meta.hasMore + nextOffset 让 agent 能续取', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      mkObs('method', `观察 K${i}`, `2026-01-${(i % 28) + 1}`),
    );
    const tool = createSearchMemoriesTool(mkRepo(many));
    const r = parse(await (tool as any).execute({ query: 'K' }));
    expect(r.meta?.total).toBe(15);
    expect(r.meta?.shown).toBe(10);
    expect(r.meta?.hasMore).toBe(true);
    expect(r.meta?.nextOffset).toBe(10);
  });

  it('用 offset 续取下一页', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      mkObs('method', `观察 K${i}`, '2026-05-01'),
    );
    const tool = createSearchMemoriesTool(mkRepo(many));
    const r = parse(await (tool as any).execute({ query: 'K', offset: 10 }));
    expect(r.meta?.shown).toBe(5);
    expect(r.meta?.hasMore).toBe(false);
    expect(r.meta?.nextOffset).toBeUndefined();
  });

  it('空 query:列全部', async () => {
    const tool = createSearchMemoriesTool(
      mkRepo([
        mkObs('method', '观察 A', '2026-05-01'),
        mkObs('method', '观察 B', '2026-05-02'),
      ]),
    );
    const r = parse(await (tool as any).execute({ query: '' }));
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.total).toBe(2);
  });

  it('空结果:not_found', async () => {
    const tool = createSearchMemoriesTool(
      mkRepo([mkObs('method', '观察', '2026-05-01')]),
    );
    const r = parse(await (tool as any).execute({ query: '不存在的词' }));
    expect(r.meta?.status).toBe('not_found');
    expect(r.meta?.total).toBe(0);
  });

  it('非法 topic 返 invalid', async () => {
    const tool = createSearchMemoriesTool(mkRepo([]));
    const r = parse(await (tool as any).execute({ query: 'x', topic: 'wuwu' }));
    expect(r.meta?.status).toBe('invalid');
  });
});
