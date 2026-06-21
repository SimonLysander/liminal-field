/**
 * SEED_SOURCES — 系统启动时种入的内置信息源「市场」。
 *
 * PR3 重要变化(Fetcher 插件 v2 落地):
 * - 每条 seed 标对应 fetcherKind + 可选 config(arxiv 的 category、掘金 cateId 等)
 * - rssUrl 字段保留作为 admin 后台展示用 URL(原生 RSS 站填实际 feed URL,
 *   非 RSS 站填能在浏览器打开的对应 endpoint/主页,实际抓取走 fetcherKind 内部逻辑)
 * - 新增源:阮一峰周刊(GitHub Issues)、知乎日报(移动 API);删除 enabled=false 的
 *   AlphaSignal/The Batch(已实现专用 fetcher,启用)
 *
 * URL 里的 `{rsshub}` 占位符在 seedSources() 内被 RSSHUB_BASE_URL env 替换;
 * 现在我们 0 个源依赖 rsshub —— 全部走官方 API / RSS / 单 HTML scrape。
 *
 * 选源标准:(1) 信息密度高 (2) 更新频次稳定 (3) 圈内公认权威。
 */
import { InfoSourceCategory } from './info-source.entity';
import { FetcherKind } from './fetchers/fetcher.interface';

export interface SeedSource {
  name: string;
  category: InfoSourceCategory;
  rssUrl: string; // 可含 {rsshub} 占位符;同时作为 admin 后台展示用 URL
  description: string;
  /** Fetcher 插件 v2 抓取方式(默认 rss)。 */
  fetcherKind?: FetcherKind;
  /** 额外 config 字段(合并进 InfoSource.config)。 */
  config?: Record<string, unknown>;
  /** 默认 true;curl 验证 URL 不通且无替代实现时设 false。 */
  enabled?: boolean;
}

export const SEED_SOURCES: SeedSource[] = [
  // ── AI(论文 + 业界周报)──────────────────────────────────────────────
  {
    name: 'HuggingFace Papers',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://huggingface.co/api/daily_papers',
    description: 'AI 每日 trending 论文,HuggingFace 社区投票',
    fetcherKind: FetcherKind.hf_papers,
  },
  {
    name: 'AlphaSignal',
    category: InfoSourceCategory.ai,
    // 无官方 RSS,改走 sitemap.xml 列出所有 /news/<slug> URL
    rssUrl: 'https://alphasignal.ai/newsletter',
    description: 'ML 工程师周报,含模型/GPU/代码动态(sitemap scrape)',
    fetcherKind: FetcherKind.alpha_signal,
  },
  {
    name: 'The Batch (DeepLearning.AI)',
    category: InfoSourceCategory.ai,
    // 官方 /feed/ 已下线,改走 archive 列表页 scrape
    rssUrl: 'https://www.deeplearning.ai/the-batch/',
    description: '吴恩达团队 AI 周报(列表页 scrape)',
    fetcherKind: FetcherKind.the_batch,
  },
  {
    name: 'Import AI (Jack Clark)',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://importai.substack.com/feed',
    description: 'Anthropic 联创周报,AI 政策 + 前沿',
  },
  {
    name: 'arXiv cs.AI',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://arxiv.org/list/cs.AI/recent',
    description: 'arXiv 人工智能预印本(API,支持 keywords 服务端检索)',
    fetcherKind: FetcherKind.arxiv,
    config: { category: 'cs.AI' },
  },
  {
    name: 'arXiv cs.LG',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://arxiv.org/list/cs.LG/recent',
    description: 'arXiv 机器学习预印本(API,支持 keywords)',
    fetcherKind: FetcherKind.arxiv,
    config: { category: 'cs.LG' },
  },
  {
    name: 'arXiv cs.CL',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://arxiv.org/list/cs.CL/recent',
    description: 'arXiv 计算语言学 / NLP(API,支持 keywords)',
    fetcherKind: FetcherKind.arxiv,
    config: { category: 'cs.CL' },
  },
  {
    name: 'Latent Space',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://www.latent.space/feed',
    description: 'swyx 的 AI 工程播客 + newsletter',
  },
  {
    name: 'Every (Chain of Thought)',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://every.to/chain-of-thought/feed',
    description: 'Dan Shipper 的 AI + 商业写作(Chain of Thought 主刊)',
  },
  {
    name: 'Simon Willison Blog',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://simonwillison.net/atom/everything/',
    description: '独立 AI 工具开发 + 深度评测',
  },
  {
    name: 'OpenAI Blog',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://openai.com/news/rss.xml',
    description: 'OpenAI 官方公告 / 模型发布',
  },

  // ── 工程(技术/编程)──────────────────────────────────────────────
  {
    name: 'Hacker News Frontpage',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://news.ycombinator.com/',
    description: 'YC 开发者每日必看(Firebase API,直拉 topstories)',
    fetcherKind: FetcherKind.hn_firebase,
  },
  {
    name: 'Lobsters',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://lobste.rs/rss',
    description: '邀请制小社区,技术纯度高、噪音低',
  },
  {
    name: 'dev.to',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://dev.to/feed',
    description: '开发者写作社区,教程类多',
  },
  {
    name: 'GitHub Trending (TypeScript)',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://github.com/trending/typescript?since=daily',
    description: '工程师在 star 什么的指标(HTML scrape)',
    fetcherKind: FetcherKind.github_trending,
    config: { language: 'typescript' },
  },
  {
    name: 'The Pragmatic Engineer',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://newsletter.pragmaticengineer.com/feed',
    description: '工程文化 + 大厂内幕周报',
  },
  {
    name: 'V2EX 首页',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://www.v2ex.com/',
    description: '国内开发者讨论(官方 API,直拉 latest topics)',
    fetcherKind: FetcherKind.v2ex,
  },
  {
    name: '掘金 · 前端',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://juejin.cn/frontend',
    description: '掘金前端版(POST API)',
    fetcherKind: FetcherKind.juejin,
    config: { cateId: '6809637767543259144' },
  },
  {
    name: '掘金 · 后端',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://juejin.cn/backend',
    description: '掘金后端版(POST API)',
    fetcherKind: FetcherKind.juejin,
    config: { cateId: '6809637769959178254' },
  },
  {
    name: '少数派',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://sspai.com/feed',
    description: '工具 / 效率 / AI 工具沉淀厚',
  },
  {
    name: '知乎日报',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://daily.zhihu.com/',
    description: '知乎日报精选(官方移动 API)',
    fetcherKind: FetcherKind.zhihu_daily,
  },
  {
    name: '阮一峰科技爱好者周刊',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://github.com/ruanyf/weekly/issues',
    description: '阮一峰周刊自荐池(GitHub Issues,头部上游)',
    fetcherKind: FetcherKind.ruanyf_weekly,
  },

  // ── 商业 ────────────────────────────────────────────────────────
  {
    name: 'TechCrunch',
    category: InfoSourceCategory.business,
    rssUrl: 'https://techcrunch.com/feed',
    description: '创投融资最广覆盖',
  },
  {
    name: 'Stratechery (Ben Thompson)',
    category: InfoSourceCategory.business,
    rssUrl: 'https://stratechery.com/feed/',
    description: '平台战略分析黄金标准',
  },
  {
    name: "Lenny's Newsletter",
    category: InfoSourceCategory.business,
    rssUrl: 'https://www.lennysnewsletter.com/feed',
    description: '产品 / 增长第一刊',
  },
  {
    name: 'Marginal Revolution',
    category: InfoSourceCategory.business,
    rssUrl: 'https://marginalrevolution.com/feed',
    description: 'Tyler Cowen 经济 / 文化日更',
  },
  {
    name: 'Decoder by Nilay Patel',
    category: InfoSourceCategory.business,
    rssUrl: 'https://feeds.megaphone.fm/recodedecode',
    description: 'The Verge 主编访谈 CEO,科技商业深度',
  },

  // ── 设计 ────────────────────────────────────────────────────────
  {
    name: 'Sidebar',
    category: InfoSourceCategory.design,
    rssUrl: 'https://sidebar.io/feed.xml',
    description: '每日 5 条精选设计链接,零噪音',
  },
  {
    name: 'Smashing Magazine',
    category: InfoSourceCategory.design,
    rssUrl: 'https://www.smashingmagazine.com/feed/',
    description: '前端 + 设计工程老牌站',
  },

  // ── 思想 · 长文 ─────────────────────────────────────────────────
  {
    name: 'Paul Graham Essays',
    category: InfoSourceCategory.longform,
    rssUrl: 'http://www.aaronsw.com/2002/feeds/pgessays.rss',
    description: '创业思想原典',
  },
  {
    name: 'LessWrong',
    category: InfoSourceCategory.longform,
    rssUrl: 'https://www.lesswrong.com/feed.xml',
    description: '理性主义 / AI 安全长文社区',
  },
  {
    name: 'Aeon',
    category: InfoSourceCategory.longform,
    rssUrl: 'https://aeon.co/feed.rss',
    description: '哲学 / 科学长文,编辑挑选',
  },
];

/** 把 seed URL 里的 {rsshub} 占位符替换成 RSSHUB_BASE_URL env 值 */
export function resolveSeedUrl(rssUrl: string): string {
  const rsshubBase = process.env.RSSHUB_BASE_URL || 'http://rsshub:1200';
  return rssUrl.replace(/\{rsshub\}/g, rsshubBase);
}
