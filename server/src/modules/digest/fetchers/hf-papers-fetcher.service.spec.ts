/**
 * HfPapersFetcher 单元测试
 * - mock ./http.utils（httpGetJson）
 * - Case 1: 正常 JSON 解析 → FetchedItem[]
 * - Case 2: HTTP 非 2xx → throw Error
 * - Case 3: keywords 本地过滤
 */
import { Test, TestingModule } from '@nestjs/testing';
import { HfPapersFetcher } from './hf-papers-fetcher.service';
import { FetcherKind } from './fetcher.interface';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from '../info-source.entity';

jest.mock('./http.utils', () => {
  const actual = jest.requireActual('./http.utils');
  return {
    ...actual,
    httpGetJson: jest.fn(),
    httpGetText: jest.fn(),
    httpPostJson: jest.fn(),
    httpFetch: jest.fn(),
  };
});

import { httpGetJson } from './http.utils';
const mockHttpGetJson = httpGetJson as jest.MockedFunction<typeof httpGetJson>;

function makeSource(): InfoSource {
  return {
    _id: 'src_hf',
    type: InfoSourceType.api,
    fetcherKind: FetcherKind.hf_papers,
    name: 'HF Daily Papers',
    config: {},
    enabled: true,
    category: InfoSourceCategory.ai,
    createdAt: new Date(),
  };
}

const SAMPLE_DATA = [
  {
    paper: {
      id: '2406.12345',
      title: 'RAG-Aware MoE Routing',
      summary: 'We propose a routing technique that improves RAG...',
      publishedAt: '2026-06-20T00:00:00.000Z',
      upvotes: 42,
    },
    title: 'RAG-Aware MoE Routing',
  },
  {
    paper: {
      id: '2406.11111',
      title: 'Diffusion Model Survey',
      summary: 'A comprehensive survey on diffusion models...',
      publishedAt: '2026-06-19T00:00:00.000Z',
      upvotes: 10,
    },
    title: 'Diffusion Model Survey',
  },
];

describe('HfPapersFetcher', () => {
  let fetcher: HfPapersFetcher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HfPapersFetcher],
    }).compile();
    fetcher = module.get(HfPapersFetcher);
    jest.clearAllMocks();
  });

  it('kind 属性正确', () => {
    expect(fetcher.kind).toBe(FetcherKind.hf_papers);
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: 正常解析
  it('正常 JSON 响应 → 返回正确 FetchedItem[]', async () => {
    mockHttpGetJson.mockResolvedValueOnce(SAMPLE_DATA);

    const items = await fetcher.fetch(makeSource(), { limit: 10 });

    expect(items).toHaveLength(2);
    expect(items[0].itemGuid).toBe('arxiv:2406.12345');
    expect(items[0].url).toBe('https://huggingface.co/papers/2406.12345');
    expect(items[0].title).toBe('RAG-Aware MoE Routing');
    expect(items[0].snippet).toContain('routing technique');
    // 按时间倒序
    expect(items[0].publishedAt!.getTime()).toBeGreaterThan(
      items[1].publishedAt!.getTime(),
    );
  });

  // Case 2: HTTP 错误
  it('HTTP 非 2xx → throw Error 含 hf_papers 前缀', async () => {
    mockHttpGetJson.mockRejectedValueOnce(
      new Error(
        'HTTP 503 Service Unavailable url=https://huggingface.co/api/daily_papers',
      ),
    );

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      /hf_papers: fetch failed/,
    );
  });

  // Case 3: keywords 本地过滤
  it('keywords 过滤：只返回 title/snippet 含 keyword 的条目', async () => {
    mockHttpGetJson.mockResolvedValueOnce(SAMPLE_DATA);

    const items = await fetcher.fetch(makeSource(), { keywords: ['RAG'] });

    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('RAG');
  });
});
