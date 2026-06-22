/**
 * ArxivFetcher 单元测试
 * - mock rss-parser（避免真实 HTTP）
 * - Case 1: 正常 Atom XML 解析 → FetchedItem[]
 * - Case 2: 解析失败 → throw Error('arxiv: fetch failed ...')
 * - Case 3: since 过滤（排除过期条目）
 * - Case 4: keywords 改为本地正则过滤（supportsServerQuery=false），query 只含 cat:、不含 ti:
 */
import { Test, TestingModule } from '@nestjs/testing';

// mock rss-parser 在 import ArxivFetcher 前
const mockParseURL = jest.fn();
jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({ parseURL: mockParseURL }));
});

import { ArxivFetcher } from './arxiv-fetcher.service';
import { FetcherKind } from './fetcher.interface';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from '../info-source.entity';

function makeSource(
  config: Record<string, unknown> = { category: 'cs.AI' },
): InfoSource {
  return {
    _id: 'src_arxiv',
    type: InfoSourceType.api,
    fetcherKind: FetcherKind.arxiv,
    name: 'arXiv cs.AI',
    config,
    enabled: true,
    category: InfoSourceCategory.ai,
    createdAt: new Date(),
  };
}

const SAMPLE_ITEMS = [
  {
    id: 'http://arxiv.org/abs/2406.12345v1',
    link: 'http://arxiv.org/abs/2406.12345v1',
    title: 'How Transparent is DiffusionGemma?',
    summary: 'We study the transparency of diffusion models...',
    published: '2026-06-21T08:00:00Z',
    isoDate: '2026-06-21T08:00:00Z',
  },
  {
    id: 'http://arxiv.org/abs/2406.11111v1',
    link: 'http://arxiv.org/abs/2406.11111v1',
    title: 'Efficient Transformer Scaling',
    summary: 'We propose a new scaling law...',
    published: '2026-06-20T08:00:00Z',
    isoDate: '2026-06-20T08:00:00Z',
  },
];

describe('ArxivFetcher', () => {
  let fetcher: ArxivFetcher;

  beforeEach(async () => {
    mockParseURL.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ArxivFetcher],
    }).compile();
    fetcher = module.get(ArxivFetcher);
  });

  it('kind 和 supportsServerQuery 属性正确', () => {
    expect(fetcher.kind).toBe(FetcherKind.arxiv);
    // keywords 改本地正则后,arxiv 不再服务端检索 → supportsServerQuery=false
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: 正常解析
  it('正常 Atom 响应 → 返回正确 FetchedItem[]', async () => {
    mockParseURL.mockResolvedValueOnce({ items: SAMPLE_ITEMS });

    const items = await fetcher.fetch(makeSource(), { limit: 10 });

    expect(items).toHaveLength(2);
    expect(items[0].itemGuid).toBe('http://arxiv.org/abs/2406.12345v1');
    expect(items[0].title).toBe('How Transparent is DiffusionGemma?');
    expect(items[0].snippet).toContain('transparency');
    expect(items[0].publishedAt).toEqual(new Date('2026-06-21T08:00:00Z'));
    // 按时间倒序：最新在前
    expect(items[0].publishedAt!.getTime()).toBeGreaterThan(
      items[1].publishedAt!.getTime(),
    );
  });

  // Case 2: parseURL 抛错 → throw Error
  it('rss-parser 失败 → throw Error 含 arxiv 前缀', async () => {
    mockParseURL.mockRejectedValueOnce(new Error('network error'));

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      /arxiv: fetch failed/,
    );
  });

  // Case 3: since 过滤
  it('since 过滤：只返回 since 之后的条目', async () => {
    mockParseURL.mockResolvedValueOnce({ items: SAMPLE_ITEMS });

    const since = new Date('2026-06-21T00:00:00Z');
    const items = await fetcher.fetch(makeSource(), { since });

    // 只有 2026-06-21 的那条通过
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('How Transparent is DiffusionGemma?');
  });

  // Case 4: keywords 改为本地正则过滤(arxiv 不再服务端 ti:);query 只含 cat、不含 ti
  it('有 keywords 时本地正则过滤,只返回命中条目;query 不含 ti:', async () => {
    mockParseURL.mockResolvedValueOnce({ items: SAMPLE_ITEMS });

    // keywords=['Gemma'] 本地正则匹配 title+snippet:只有 DiffusionGemma 那条命中
    const items = await fetcher.fetch(makeSource(), {
      keywords: ['Gemma'],
      limit: 10,
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('How Transparent is DiffusionGemma?');
    // arxiv 不再拼服务端 ti:,query 只按分类拉
    const url = mockParseURL.mock.calls[0][0] as string;
    expect(url).toContain('cat:cs.AI');
    expect(url).not.toContain('ti:');
  });
});
