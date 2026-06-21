/**
 * FetcherRegistry — 按 FetcherKind 把 InfoSource 分发到对应 SourceFetcher 实例。
 *
 * v2 关键变化：
 * - 路由 key 从 InfoSourceType（4 大类 discriminator）改为 FetcherKind（11 种细分能力）
 * - 新增 `fetchMany(sources, opts)` 并行打多个源 + Promise.allSettled，单源失败不挂整次
 *   browse 工具改成多源并行后专用这个入口，单源失败仅日志告警、不阻塞其他源
 *
 * 注册方式：所有 Fetcher 通过 NestJS DI 注入到构造器，自动按 fetcher.kind 建 map。
 * 加新 Fetcher = 在 DigestSharedModule.providers 加一个 @Injectable 类，构造器签名加一个形参。
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';

import type { InfoSource } from '../info-source.entity';
import {
  FetcherKind,
  type SourceFetcher,
  type FetchedItem,
  type FetchOptions,
} from './fetcher.interface';
import { RssFetcher } from './rss-fetcher.service';
import { ArxivFetcher } from './arxiv-fetcher.service';
import { HfPapersFetcher } from './hf-papers-fetcher.service';
import { HnFirebaseFetcher } from './hn-firebase-fetcher.service';
import { V2exFetcher } from './v2ex-fetcher.service';
import { JuejinFetcher } from './juejin-fetcher.service';
import { ZhihuDailyFetcher } from './zhihu-daily-fetcher.service';
import { RuanyfWeeklyFetcher } from './ruanyf-weekly-fetcher.service';
import { GithubTrendingFetcher } from './github-trending-fetcher.service';
import { TheBatchFetcher } from './the-batch-fetcher.service';
import { AlphaSignalFetcher } from './alpha-signal-fetcher.service';

/** 单源 fetch 结果（fetchMany 返回的每条元素，单源失败也有结构化错误） */
export interface FetchManyResultPerSource {
  source: InfoSource;
  status: 'ok' | 'failed';
  items: FetchedItem[];
  /** failed 时的错误信息（已转 string，不暴露 stack 给上层） */
  error?: string;
  /** 耗时毫秒，便于排查慢源 */
  durationMs: number;
}

@Injectable()
export class FetcherRegistry {
  private readonly logger = new Logger(FetcherRegistry.name);
  private readonly map = new Map<FetcherKind, SourceFetcher>();

  constructor(
    rss: RssFetcher,
    arxiv: ArxivFetcher,
    hfPapers: HfPapersFetcher,
    hnFirebase: HnFirebaseFetcher,
    v2ex: V2exFetcher,
    juejin: JuejinFetcher,
    zhihuDaily: ZhihuDailyFetcher,
    ruanyfWeekly: RuanyfWeeklyFetcher,
    githubTrending: GithubTrendingFetcher,
    theBatch: TheBatchFetcher,
    alphaSignal: AlphaSignalFetcher,
  ) {
    [
      rss,
      arxiv,
      hfPapers,
      hnFirebase,
      v2ex,
      juejin,
      zhihuDaily,
      ruanyfWeekly,
      githubTrending,
      theBatch,
      alphaSignal,
    ].forEach((f) => this.register(f));
  }

  private register(f: SourceFetcher): void {
    this.map.set(f.kind, f);
    this.logger.log(
      `[register] ${f.kind} (supportsServerQuery=${f.supportsServerQuery})`,
    );
  }

  /** 取对应 kind 的 fetcher；kind 不支持时抛 BadRequestException */
  get(kind: FetcherKind): SourceFetcher {
    const f = this.map.get(kind);
    if (!f) {
      throw new BadRequestException(`fetcher: 暂不支持的 kind ${kind}`);
    }
    return f;
  }

  /**
   * 单源 fetch（旧调用方兼容入口，等价于 get(source.fetcherKind).fetch(source, opts)）。
   * 失败时 throw — 与原签名一致；不做 allSettled 包装。
   * 多源并行请用 fetchMany。
   */
  async fetch(
    source: InfoSource,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    return this.get(source.fetcherKind).fetch(source, options);
  }

  /**
   * 多源并行 fetch — browse 工具的核心入口（v4 重写后的 browse({sourceIds?, keywords?})）。
   *
   * 行为：
   * - Promise.allSettled 包装每个源调用 → 单源失败不阻塞其他
   * - 已禁用源（enabled=false）直接 skip，不计入返回
   * - 返回每个源独立结构化结果（status/items/error/durationMs），调用方自行合并/去重
   *
   * 不在这里 dedup / sort / cap —— 这些是 browse 工具的职责（涉及 ProcessedFeedItem 去重、
   * ctx.fetchedItemsMap 包装 ref，与 fetcher 层无关）。
   */
  async fetchMany(
    sources: InfoSource[],
    options?: FetchOptions,
  ): Promise<FetchManyResultPerSource[]> {
    const enabled = sources.filter((s) => s.enabled);
    const skipped = sources.length - enabled.length;
    if (skipped > 0) {
      this.logger.debug(
        `[fetchMany] 跳过 ${skipped} 个禁用源 (传入 ${sources.length} 启用 ${enabled.length})`,
      );
    }

    const results = await Promise.allSettled(
      enabled.map(async (source) => {
        const t0 = Date.now();
        try {
          const fetcher = this.get(source.fetcherKind);
          const items = await fetcher.fetch(source, options);
          return {
            source,
            status: 'ok' as const,
            items,
            durationMs: Date.now() - t0,
          };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `[fetchMany] 源「${source.name}」(${source._id}) 抓取失败: ${reason}`,
          );
          return {
            source,
            status: 'failed' as const,
            items: [],
            error: reason,
            durationMs: Date.now() - t0,
          };
        }
      }),
    );

    // allSettled 包装后内部 await 已 try/catch，理论上不会 rejected，但兜底转 failed
    return results.map((r, idx): FetchManyResultPerSource => {
      if (r.status === 'fulfilled') return r.value;
      const reason =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      return {
        source: enabled[idx],
        status: 'failed',
        items: [],
        error: reason,
        durationMs: 0,
      };
    });
  }
}
