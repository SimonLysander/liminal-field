/**
 * FetcherRegistry — 按 InfoSourceType 分发到对应 SourceFetcher 实例。
 *
 * 设计思路：
 * - 用 Map 做 O(1) 查找；新增 fetcher 只需在构造器参数里注入并调用 register()。
 * - get() 拿不到直接 throw BadRequestException，上层无需 null 检查。
 * - 作为 export 提供给 task #36c 工具集使用。
 */
import { Injectable, BadRequestException } from '@nestjs/common';

import { InfoSourceType } from '../info-source.entity';
import type { SourceFetcher } from './fetcher.interface';
import { RssFetcher } from './rss-fetcher.service';

@Injectable()
export class FetcherRegistry {
  private readonly map = new Map<InfoSourceType, SourceFetcher>();

  constructor(
    rss: RssFetcher,
    // 未来扩展：webpage: WebpageFetcher, api: ApiFetcher, mailbox: MailboxFetcher
  ) {
    this.register(rss);
  }

  private register(f: SourceFetcher): void {
    this.map.set(f.type, f);
  }

  /** 取对应 type 的 fetcher；type 不支持时抛 BadRequestException */
  get(type: InfoSourceType): SourceFetcher {
    const f = this.map.get(type);
    if (!f) throw new BadRequestException(`fetcher: 暂不支持的 type ${type}`);
    return f;
  }
}
