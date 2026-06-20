/**
 * FetcherRegistry 单元测试
 */
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

// mock rss-parser 避免 RssFetcher 构造时报错
jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({ parseURL: jest.fn() }));
});

import { FetcherRegistry } from './fetcher-registry.service';
import { RssFetcher } from './rss-fetcher.service';
import { InfoSourceType } from '../info-source.entity';

describe('FetcherRegistry', () => {
  let registry: FetcherRegistry;
  let rssFetcher: RssFetcher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RssFetcher, FetcherRegistry],
    }).compile();

    registry = module.get(FetcherRegistry);
    rssFetcher = module.get(RssFetcher);
  });

  // Case 1: get(rss) 返回 RssFetcher
  it('get(InfoSourceType.rss) 应返回 RssFetcher 实例', () => {
    const fetcher = registry.get(InfoSourceType.rss);
    expect(fetcher).toBe(rssFetcher);
    expect(fetcher.type).toBe(InfoSourceType.rss);
  });

  // Case 2: get(unknown) 抛 BadRequestException
  it('get(不支持的 type) 应 throw BadRequestException', () => {
    expect(() => registry.get(InfoSourceType.webpage)).toThrow(
      BadRequestException,
    );
    expect(() => registry.get(InfoSourceType.api)).toThrow(BadRequestException);
  });
});
