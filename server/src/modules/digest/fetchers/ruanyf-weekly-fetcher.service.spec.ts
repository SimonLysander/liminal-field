/**
 * RuanyfWeeklyFetcher 单元测试
 * - mock 全局 fetch
 * - Case 1: 正常 GitHub Issues 响应 → FetchedItem[]
 * - Case 2: HTTP 非 2xx → throw Error
 * - Case 3: since 过滤
 */
import { Test, TestingModule } from '@nestjs/testing';
import { RuanyfWeeklyFetcher } from './ruanyf-weekly-fetcher.service';
import { FetcherKind } from './fetcher.interface';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from '../info-source.entity';

function makeSource(): InfoSource {
  return {
    _id: 'src_ruanyf',
    type: InfoSourceType.api,
    fetcherKind: FetcherKind.ruanyf_weekly,
    name: '阮一峰周刊',
    config: {},
    enabled: true,
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
  };
}

const SAMPLE_DATA = [
  {
    number: 10405,
    title: '【网站自荐】AIMoCap - 免费动捕网站',
    html_url: 'https://github.com/ruanyf/weekly/issues/10405',
    created_at: '2026-06-21T08:00:00Z',
    body: '我做了一个网站，用 AI 做动作捕捉...',
  },
  {
    number: 10404,
    title: '【开源项目】TypeScript 工具库',
    html_url: 'https://github.com/ruanyf/weekly/issues/10404',
    created_at: '2026-06-20T08:00:00Z',
    body: '开源了一个 TypeScript 工具库...',
  },
];

function mockOkJson(data: unknown): unknown {
  return { ok: true, json: jest.fn().mockResolvedValue(data) };
}

describe('RuanyfWeeklyFetcher', () => {
  let fetcher: RuanyfWeeklyFetcher;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RuanyfWeeklyFetcher],
    }).compile();
    fetcher = module.get(RuanyfWeeklyFetcher);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('kind 属性正确', () => {
    expect(fetcher.kind).toBe(FetcherKind.ruanyf_weekly);
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: 正常解析
  it('正常 GitHub Issues 响应 → FetchedItem[]', async () => {
    fetchSpy.mockResolvedValueOnce(mockOkJson(SAMPLE_DATA));

    const items = await fetcher.fetch(makeSource(), { limit: 10 });

    expect(items).toHaveLength(2);
    expect(items[0].itemGuid).toBe('ruanyf_10405');
    expect(items[0].url).toBe('https://github.com/ruanyf/weekly/issues/10405');
    expect(items[0].title).toContain('AIMoCap');
    expect(items[0].snippet).toContain('AI 做动作捕捉');
    expect(items[0].publishedAt).toEqual(new Date('2026-06-21T08:00:00Z'));
    // 倒序
    expect(items[0].publishedAt!.getTime()).toBeGreaterThan(
      items[1].publishedAt!.getTime(),
    );
  });

  // Case 2: HTTP 错误
  it('HTTP 非 2xx → throw Error 含 ruanyf_weekly 前缀', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      /ruanyf_weekly: fetch failed/,
    );
  });

  // Case 3: since 过滤
  it('since 过滤：只返回 since 之后的 issue', async () => {
    fetchSpy.mockResolvedValueOnce(mockOkJson(SAMPLE_DATA));

    const since = new Date('2026-06-21T00:00:00Z');
    const items = await fetcher.fetch(makeSource(), { since });

    expect(items).toHaveLength(1);
    expect(items[0].itemGuid).toBe('ruanyf_10405');
  });
});
