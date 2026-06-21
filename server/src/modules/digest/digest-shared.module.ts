/**
 * DigestSharedModule — digest 模块的底层数据 + 抓取能力共享层。
 *
 * 为啥要这一层:
 * agent 模块的 ToolCatalog 需要 browse/pick 工具,而 browse/pick 工具需要
 * InfoSourceRepository / FetcherRegistry / DigestTaskRepository / ProcessedFeedItemRepository。
 * 如果 agent 直接 import DigestModule,会形成 agent → digest → agent(sub-agent)
 * 循环。把"无业务、纯仓储 + 抓取"抽出来,agent 和 digest 都从这里拿。
 *
 * exports 只挑"无业务依赖"的:
 *   - 各 entity 的 Repository(单纯 mongo CRUD)
 *   - FetcherRegistry + 各 Fetcher(RSS 抓取,无业务)
 * 不导出 Service 类(那是业务,留在 DigestModule)。
 */
import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';

import { InfoSource } from './info-source.entity';
import { InfoSourceRepository } from './info-source.repository';
import { SmartTopicConfig } from './smart-topic-config.entity';
import { SmartTopicConfigRepository } from './smart-topic-config.repository';
import { ProcessedFeedItem } from './processed-feed-item.entity';
import { ProcessedFeedItemRepository } from './processed-feed-item.repository';
import { DigestTask } from './digest-task.entity';
import { DigestTaskRepository } from './digest-task.repository';
import { DigestReport } from './digest-report.entity';
import { DigestReportRepository } from './digest-report.repository';

import { RssFetcher } from './fetchers/rss-fetcher.service';
import { ArxivFetcher } from './fetchers/arxiv-fetcher.service';
import { HfPapersFetcher } from './fetchers/hf-papers-fetcher.service';
import { HnFirebaseFetcher } from './fetchers/hn-firebase-fetcher.service';
import { V2exFetcher } from './fetchers/v2ex-fetcher.service';
import { JuejinFetcher } from './fetchers/juejin-fetcher.service';
import { ZhihuDailyFetcher } from './fetchers/zhihu-daily-fetcher.service';
import { RuanyfWeeklyFetcher } from './fetchers/ruanyf-weekly-fetcher.service';
import { GithubTrendingFetcher } from './fetchers/github-trending-fetcher.service';
import { TheBatchFetcher } from './fetchers/the-batch-fetcher.service';
import { AlphaSignalFetcher } from './fetchers/alpha-signal-fetcher.service';
import { FetcherRegistry } from './fetchers/fetcher-registry.service';

// TypegooseModule.forFeature 是 DynamicModule;export 它让外部模块也能拿到 models
// (InfoSourceService 等直接 @Inject(getModelToken(InfoSource.name)) 用到 model token,
// 必须 re-export 才能跨模块解析)
const typegoose = TypegooseModule.forFeature([
  InfoSource,
  SmartTopicConfig,
  ProcessedFeedItem,
  DigestTask,
  DigestReport,
]);

@Module({
  imports: [typegoose],
  providers: [
    InfoSourceRepository,
    SmartTopicConfigRepository,
    ProcessedFeedItemRepository,
    DigestTaskRepository,
    DigestReportRepository,
    RssFetcher,
    ArxivFetcher,
    HfPapersFetcher,
    HnFirebaseFetcher,
    V2exFetcher,
    JuejinFetcher,
    ZhihuDailyFetcher,
    RuanyfWeeklyFetcher,
    GithubTrendingFetcher,
    TheBatchFetcher,
    AlphaSignalFetcher,
    FetcherRegistry,
  ],
  exports: [
    typegoose,
    InfoSourceRepository,
    SmartTopicConfigRepository,
    ProcessedFeedItemRepository,
    DigestTaskRepository,
    DigestReportRepository,
    FetcherRegistry,
    // RssFetcher 不 export — 只让 FetcherRegistry 用
  ],
})
export class DigestSharedModule {}
