import { BadRequestException, Logger } from '@nestjs/common';
import { createListKnowledgeBaseTool } from '../list-content.tool';
import type { ToolResult } from '../tool-result';
import type { ContentService } from '../../../content/content.service';

describe('list_knowledge_base pagination', () => {
  const listKnowledgeBase = jest.fn<
    ReturnType<ContentService['listKnowledgeBase']>,
    Parameters<ContentService['listKnowledgeBase']>
  >();
  const tool = createListKnowledgeBaseTool({ listKnowledgeBase });

  async function run(
    input: { scope?: string; limit?: number; offset?: number } = {},
  ): Promise<ToolResult> {
    const result = await tool.execute!(input, {
      toolCallId: 'list-test',
      messages: [],
    });
    if (typeof result !== 'string')
      throw new Error('Expected a serialized tool result');
    return JSON.parse(result) as ToolResult;
  }

  beforeEach(() => listKnowledgeBase.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it('passes exact offsets without converting them to page numbers', async () => {
    listKnowledgeBase.mockResolvedValue({
      items: [
        {
          contentItemId: 'ci-quant',
          title: '量化交易',
          scope: 'notes',
          path: '投资方法',
          snippet: '',
          updatedAt: '2026-09-28T00:00:00Z',
        },
      ],
      hasMore: true,
    });
    const result = await run({ scope: 'notes', limit: 50, offset: 37 });
    expect(listKnowledgeBase).toHaveBeenCalledWith({
      scope: 'notes',
      limit: 50,
      offset: 37,
    });
    expect(result.meta).toMatchObject({
      status: 'ok',
      shown: 1,
      offset: 37,
      hasMore: true,
      nextOffset: 87,
    });
    expect(result.summary).toBe('笔记 · 本页 1 篇 · 还有更多');
    expect(result.detail).toContain('量化交易 · ci-quant · 投资方法');
  });

  it('does not claim a global count on the last page', async () => {
    listKnowledgeBase.mockResolvedValue({ items: [], hasMore: false });
    const result = await run({ offset: 200 });
    expect(result.meta).toMatchObject({
      shown: 0,
      offset: 200,
      hasMore: false,
    });
    expect(result.meta?.total).toBeUndefined();
    expect(result.meta?.nextOffset).toBeUndefined();
    expect(result.summary).not.toContain('知识库还没有内容');
  });

  it('reports invalid parameters separately from storage failure', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    listKnowledgeBase.mockRejectedValue(
      new BadRequestException('invalid offset'),
    );
    expect((await run({ offset: -1 })).meta?.status).toBe('invalid');
    expect(warn).toHaveBeenCalled();
  });

  it('logs failure context and stack without presenting a retry instruction', async () => {
    const error = new Error('database unavailable');
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    listKnowledgeBase.mockRejectedValue(error);
    const result = await run({ scope: 'notes' });
    expect(result.meta?.status).toBe('error');
    expect(result.summary).toBe('列出内容失败');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'notes', limit: 50, offset: 0 }),
      error.stack,
    );
  });
});
