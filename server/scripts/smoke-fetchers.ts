/**
 * Smoke test: 11 个 Fetcher 真实 HTTP 拉取
 *
 * 跑法: cd server && npx ts-node scripts/smoke-fetchers.ts
 * 不依赖 MongoDB / Nest IoC，直接 new 每个 Fetcher 调 fetch()。
 * 输出每个源:状态(ok/fail) + 耗时 + 拉到几条 + 头 2 条 title 预览。
 */
import { InfoSource, InfoSourceCategory, InfoSourceType } from '../src/modules/digest/info-source.entity';
import { FetcherKind, type SourceFetcher } from '../src/modules/digest/fetchers/fetcher.interface';
import { RssFetcher } from '../src/modules/digest/fetchers/rss-fetcher.service';
import { ArxivFetcher } from '../src/modules/digest/fetchers/arxiv-fetcher.service';
import { HfPapersFetcher } from '../src/modules/digest/fetchers/hf-papers-fetcher.service';
import { HnFirebaseFetcher } from '../src/modules/digest/fetchers/hn-firebase-fetcher.service';
import { V2exFetcher } from '../src/modules/digest/fetchers/v2ex-fetcher.service';
import { JuejinFetcher } from '../src/modules/digest/fetchers/juejin-fetcher.service';
import { ZhihuDailyFetcher } from '../src/modules/digest/fetchers/zhihu-daily-fetcher.service';
import { RuanyfWeeklyFetcher } from '../src/modules/digest/fetchers/ruanyf-weekly-fetcher.service';
import { GithubTrendingFetcher } from '../src/modules/digest/fetchers/github-trending-fetcher.service';
import { TheBatchFetcher } from '../src/modules/digest/fetchers/the-batch-fetcher.service';
import { AlphaSignalFetcher } from '../src/modules/digest/fetchers/alpha-signal-fetcher.service';

function makeSource(
  name: string,
  kind: FetcherKind,
  config: Record<string, unknown> = {},
): InfoSource {
  return {
    _id: `src_smoke_${kind}`,
    type: InfoSourceType.rss,
    fetcherKind: kind,
    name,
    config,
    enabled: true,
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
  } as InfoSource;
}

interface Case {
  label: string;
  fetcher: SourceFetcher;
  source: InfoSource;
}

const CASES: Case[] = [
  // RSS (代表性 1 个)
  {
    label: 'Latent Space (rss)',
    fetcher: new RssFetcher(),
    source: makeSource('Latent Space', FetcherKind.rss, {
      url: 'https://www.latent.space/feed',
    }),
  },
  // arXiv 三个 category 全测
  {
    label: 'arXiv cs.AI',
    fetcher: new ArxivFetcher(),
    source: makeSource('arXiv cs.AI', FetcherKind.arxiv, { category: 'cs.AI' }),
  },
  {
    label: 'arXiv cs.LG',
    fetcher: new ArxivFetcher(),
    source: makeSource('arXiv cs.LG', FetcherKind.arxiv, { category: 'cs.LG' }),
  },
  {
    label: 'arXiv cs.CL',
    fetcher: new ArxivFetcher(),
    source: makeSource('arXiv cs.CL', FetcherKind.arxiv, { category: 'cs.CL' }),
  },
  // arXiv keywords 服务端 query
  {
    label: 'arXiv cs.AI + keywords[transformer]',
    fetcher: new ArxivFetcher(),
    source: makeSource('arXiv cs.AI', FetcherKind.arxiv, { category: 'cs.AI' }),
  },
  // HuggingFace Papers
  {
    label: 'HuggingFace Papers',
    fetcher: new HfPapersFetcher(),
    source: makeSource('HF Papers', FetcherKind.hf_papers),
  },
  // HN Firebase
  {
    label: 'Hacker News Frontpage',
    fetcher: new HnFirebaseFetcher(),
    source: makeSource('HN', FetcherKind.hn_firebase),
  },
  // V2EX
  {
    label: 'V2EX 首页',
    fetcher: new V2exFetcher(),
    source: makeSource('V2EX', FetcherKind.v2ex),
  },
  // 掘金
  {
    label: '掘金 · 前端',
    fetcher: new JuejinFetcher(),
    source: makeSource('掘金前端', FetcherKind.juejin, {
      cateId: '6809637767543259144',
    }),
  },
  // 知乎日报
  {
    label: '知乎日报',
    fetcher: new ZhihuDailyFetcher(),
    source: makeSource('知乎日报', FetcherKind.zhihu_daily),
  },
  // 阮一峰周刊
  {
    label: '阮一峰周刊',
    fetcher: new RuanyfWeeklyFetcher(),
    source: makeSource('阮一峰周刊', FetcherKind.ruanyf_weekly),
  },
  // GitHub Trending
  {
    label: 'GitHub Trending TS',
    fetcher: new GithubTrendingFetcher(),
    source: makeSource('GH Trending', FetcherKind.github_trending, {
      language: 'typescript',
    }),
  },
  // The Batch
  {
    label: 'The Batch (scrape)',
    fetcher: new TheBatchFetcher(),
    source: makeSource('The Batch', FetcherKind.the_batch),
  },
  // AlphaSignal
  {
    label: 'AlphaSignal (sitemap)',
    fetcher: new AlphaSignalFetcher(),
    source: makeSource('AlphaSignal', FetcherKind.alpha_signal),
  },
];

interface Result {
  label: string;
  status: 'ok' | 'fail';
  count: number;
  durationMs: number;
  error?: string;
  preview?: string[];
}

async function runOne(c: Case): Promise<Result> {
  const t0 = Date.now();
  // 第 5 个 case 是 arxiv + keywords,用 options.keywords 走 server-side query
  const isKeywordsCase = c.label.includes('keywords');
  const opts = isKeywordsCase
    ? { limit: 5, keywords: ['transformer'] }
    : { limit: 5 };
  try {
    const items = await c.fetcher.fetch(c.source, opts);
    return {
      label: c.label,
      status: 'ok',
      count: items.length,
      durationMs: Date.now() - t0,
      preview: items.slice(0, 2).map((i) => i.title.slice(0, 60)),
    };
  } catch (err) {
    return {
      label: c.label,
      status: 'fail',
      count: 0,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  console.log(`\n🧪 Fetcher smoke test —— 真实 HTTP 拉取 ${CASES.length} 个源\n`);

  // 并发跑(单 fetcher 失败不阻塞其他),Promise.allSettled 在 fetcher 已 try/catch 后
  // 改用 Promise.all 即可(runOne 自己已经把 error 转 status='fail')
  const results = await Promise.all(CASES.map(runOne));

  let okCount = 0;
  let failCount = 0;

  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : '❌';
    const stats = `${r.count} 条 · ${r.durationMs}ms`;
    console.log(`${icon} ${r.label.padEnd(40)} ${stats}`);
    if (r.preview && r.preview.length > 0) {
      for (const p of r.preview) {
        console.log(`   ▸ ${p}`);
      }
    }
    if (r.error) {
      console.log(`   ⚠ ${r.error.slice(0, 200)}`);
    }
    console.log();
    if (r.status === 'ok') okCount++;
    else failCount++;
  }

  console.log(`\n📊 总结: ${okCount}/${CASES.length} 成功, ${failCount} 失败\n`);
  if (failCount > 0) {
    process.exit(1);
  }
}

void main();
