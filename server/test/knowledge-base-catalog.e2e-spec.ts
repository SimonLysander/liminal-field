import { ContentService } from '../src/modules/content/content.service';
import { ContentRepository } from '../src/modules/content/content.repository';
import { NavigationRepository } from '../src/modules/navigation/navigation.repository';
import { createListKnowledgeBaseTool } from '../src/modules/agent/tools/list-content.tool';
import type { ToolResult } from '../src/modules/agent/tools/tool-result';
import { TestContext } from './helpers';

describe('Knowledge base catalog (Mongo integration)', () => {
  const ctx = new TestContext();
  let content: ContentService;
  let noteIds: string[];

  beforeAll(async () => {
    await ctx.setup();
    content = ctx.app.get(ContentService);
    const repository = ctx.app.get(ContentRepository);
    const navigation = ctx.app.get(NavigationRepository);
    noteIds = [];
    // 先放 51 篇其它范围内容，确保任何笔记都在旧查询的全局第一页之外。
    for (let index = 0; index < 108; index += 1) {
      const scope = index < 51 ? 'gallery' : 'notes';
      const id = `ci-catalog-${String(index).padStart(3, '0')}`;
      const title = index === 107 ? '量化交易' : `catalog-${index}`;
      const time = new Date(Date.UTC(2026, 8, 28, 0, 0, 108 - index));
      await repository.create({
        id,
        latestVersion: { title, commitHash: '' },
        publishedVersion: null,
        changeLogs: [],
        createdAt: time,
        updatedAt: time,
      });
      await navigation.create({ name: title, scope, contentItemId: id });
      if (scope === 'notes') noteIds.push(id);
    }
  });
  afterAll(async () => {
    await ctx.teardown();
  });

  async function list(input: {
    scope?: string;
    limit?: number;
    offset?: number;
  }): Promise<ToolResult> {
    const tool = createListKnowledgeBaseTool(content);
    const result = await tool.execute!(input, {
      toolCallId: 'catalog-e2e',
      messages: [],
    });
    if (typeof result !== 'string')
      throw new Error('Expected a serialized tool result');
    return JSON.parse(result) as ToolResult;
  }

  it('fills a scoped page even when no matching records are in the newest global 51', async () => {
    const result = await list({ scope: 'notes' });
    expect(result.meta).toMatchObject({
      shown: 50,
      offset: 0,
      hasMore: true,
      nextOffset: 50,
    });
    expect(result.detail?.split('\n')).toHaveLength(50);
    expect(result.detail).toContain(noteIds[0]);
    expect(result.detail).not.toContain('[gallery]');
    expect(result.summary).toBe('笔记 · 本页 50 篇 · 还有更多');
  });

  it('returns the correct last page and the old quantitative trading node', async () => {
    const result = await list({ scope: 'notes', offset: 50 });
    expect(result.meta).toMatchObject({ shown: 7, offset: 50, hasMore: false });
    expect(result.meta?.nextOffset).toBeUndefined();
    expect(result.detail).toContain('量化交易 · ci-catalog-107');
    expect(result.summary).toBe('笔记 · 本页 7 篇');
  });

  it('has no gaps or duplicates when following lookahead-based offsets', async () => {
    const found: string[] = [];
    let offset = 0;
    while (true) {
      const page = await content.listKnowledgeBase({
        scope: 'notes',
        limit: 10,
        offset,
      });
      found.push(...page.items.map((item) => item.contentItemId));
      if (!page.hasMore) break;
      offset += 10;
    }
    expect(found).toEqual(noteIds);
    expect(new Set(found).size).toBe(57);
  });

  it('supports offsets not aligned to the page size', async () => {
    const page = await content.listKnowledgeBase({
      scope: 'notes',
      limit: 10,
      offset: 37,
    });
    expect(page.items.map((item) => item.contentItemId)).toEqual(
      noteIds.slice(37, 47),
    );
    expect(page.hasMore).toBe(true);
  });

  it('distinguishes an empty page or scope from an empty knowledge base', async () => {
    const pastEnd = await list({ scope: 'notes', offset: 100 });
    const emptyScope = await list({ scope: 'anthology' });
    for (const result of [pastEnd, emptyScope]) {
      expect(result.meta).toMatchObject({
        status: 'ok',
        shown: 0,
        hasMore: false,
      });
      expect(result.meta?.total).toBeUndefined();
      expect(result.summary).toBe('当前范围本页没有内容');
    }
  });

  it('preserves unscoped ordering and uses content IDs as a deterministic tie-breaker', async () => {
    const global = await content.listKnowledgeBase({ limit: 52, offset: 0 });
    expect(global.items).toHaveLength(52);
    expect(global.items[0].scope).toBe('gallery');
    expect(global.items[51].contentItemId).toBe(noteIds[0]);
    expect(global.hasMore).toBe(true);

    const repository = ctx.app.get(ContentRepository);
    const navigation = ctx.app.get(NavigationRepository);
    for (const id of ['ci-tie-b', 'ci-tie-a']) {
      const time = new Date('2026-09-29T00:00:00Z');
      await repository.create({
        id,
        latestVersion: { title: id, commitHash: '' },
        changeLogs: [],
        createdAt: time,
        updatedAt: time,
      });
      await navigation.create({
        name: id,
        scope: 'anthology',
        contentItemId: id,
      });
    }
    const page = await content.listKnowledgeBase({
      scope: 'anthology',
      limit: 2,
      offset: 0,
    });
    expect(page.items.map((item) => item.contentItemId)).toEqual([
      'ci-tie-a',
      'ci-tie-b',
    ]);
    expect(page.hasMore).toBe(false);
  });
});
