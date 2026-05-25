/**
 * Agent 工具输出契约测试 —— 锁定 summary / meta 格式 + 边角行为。
 * 这些格式经过多轮人工打磨(行内 = 工具 参数 · 统计;⎿ = 真实结果;read 行号范围;计划清空…),
 * 用确定性单测固化,防回归。
 */
import { createListKnowledgeBaseTool } from '../list-content.tool';
import { createSearchKnowledgeBaseTool } from '../search-content.tool';
import { createWriteTasksTool } from '../write-tasks.tool';
// 注:read-content / get-current-document 因 import './markdown.utils.js'(ESM 风格扩展名)
// 在 jest 默认 resolver 下解析失败,其行号范围格式已由 e2e 验证;待配 jest moduleNameMapper 再补单测。

// execute 第二参(options)我们的工具用不到,测试里给个空对象
const RUN = {} as never;

type Parsed = {
  summary: string;
  detail?: string;
  meta?: Record<string, unknown>;
};
const parse = (raw: string): Parsed => JSON.parse(raw) as Parsed;

function mkItem(
  title: string,
  scope: string,
  extra: Record<string, unknown> = {},
) {
  return {
    title,
    scope,
    contentItemId: `ci_${title}`,
    path: '',
    snippet: '',
    updatedAt: '2026-05-20T00:00:00Z',
    ...extra,
  };
}

describe('list_knowledge_base', () => {
  it('全部:行内带类型构成,无 ⎿', async () => {
    const content = {
      searchWithScope: jest
        .fn()
        .mockResolvedValue([
          ...Array.from({ length: 44 }, (_, i) => mkItem(`n${i}`, 'notes')),
          ...Array.from({ length: 6 }, (_, i) => mkItem(`g${i}`, 'gallery')),
        ]),
    };
    const tool = createListKnowledgeBaseTool(content as never);
    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({}, RUN),
    );
    expect(r.summary).toBe('全部 · 笔记 44 · 相册 6 · 共 50 篇');
    expect(r.meta?.list).toBeUndefined();
  });

  it('指定范围:行内 = 范围词 · 共 N 篇', async () => {
    const content = {
      searchWithScope: jest
        .fn()
        .mockResolvedValue(
          Array.from({ length: 44 }, (_, i) => mkItem(`n${i}`, 'notes')),
        ),
    };
    const tool = createListKnowledgeBaseTool(content as never);
    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({ scope: 'notes' }, RUN),
    );
    expect(r.summary).toBe('笔记 · 共 44 篇');
  });

  it('空库:not 报错,status ok total 0', async () => {
    const content = { searchWithScope: jest.fn().mockResolvedValue([]) };
    const tool = createListKnowledgeBaseTool(content as never);
    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({}, RUN),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.total).toBe(0);
  });
});

describe('search_knowledge_base', () => {
  it('命中:行内 = 「关键词」· 命中 N 篇;⎿ = 标题·类型—摘要', async () => {
    const content = {
      searchWithScope: jest
        .fn()
        .mockResolvedValue([
          mkItem('排序', 'notes', { snippet: '快速排序平均 O(n log n)' }),
          mkItem('查找', 'notes', { snippet: '折半查找 ASL' }),
        ]),
    };
    const tool = createSearchKnowledgeBaseTool(content as never);
    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({ query: '排序' }, RUN),
    );
    expect(r.summary).toBe('搜「排序」· 命中 2 篇'.replace('搜', '')); // 行内无"搜"
    expect(r.summary).toBe('「排序」· 命中 2 篇');
    expect(r.meta?.list).toEqual([
      '排序 · 笔记 — 快速排序平均 O(n log n)',
      '查找 · 笔记 — 折半查找 ASL',
    ]);
  });

  it('未命中:status not_found', async () => {
    const content = { searchWithScope: jest.fn().mockResolvedValue([]) };
    const tool = createSearchKnowledgeBaseTool(content as never);
    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({ query: '量子计算' }, RUN),
    );
    expect(r.summary).toContain('没找到');
    expect(r.meta?.status).toBe('not_found');
  });
});

describe('write_tasks', () => {
  it('列计划:summary = 计划 done/total', async () => {
    const repo = { setTasks: jest.fn().mockResolvedValue(undefined) };
    const tool = createWriteTasksTool(repo as never, 'sess1');
    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute(
        {
          title: '排序综述',
          tasks: [
            { title: 'a', status: 'done' },
            { title: 'b', status: 'in_progress' },
            { title: 'c', status: 'pending' },
          ],
        },
        RUN,
      ),
    );
    expect(r.summary).toBe('计划 1/3');
    expect(repo.setTasks).toHaveBeenCalled();
  });

  it('传空数组:清空计划', async () => {
    const repo = { setTasks: jest.fn().mockResolvedValue(undefined) };
    const tool = createWriteTasksTool(repo as never, 'sess1');
    const r = parse(
      await (
        tool as never as {
          execute: (input: unknown, options: unknown) => Promise<string>;
        }
      ).execute({ tasks: [] }, RUN),
    );
    expect(r.summary).toBe('已清空计划');
  });
});
