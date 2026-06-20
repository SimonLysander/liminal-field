/**
 * SEED_SOURCES — 系统启动时种入的内置信息源「市场」。
 *
 * URL 里的 `{rsshub}` 占位符在 seedSources() 内被 RSSHUB_BASE_URL env
 * （默认 http://rsshub:1200）替换，避免硬编码部署细节。
 * 上线后增删调这里即可，不需要数据库迁移。
 *
 * 选源标准：(1) 信息密度高 (2) 更新频次稳定 (3) 圈内公认权威。
 * 不收录纯娱乐/纯社交/反爬严重的站点。
 */
import { InfoSourceCategory } from './info-source.entity';

export interface SeedSource {
  name: string;
  category: InfoSourceCategory;
  rssUrl: string; // 可含 {rsshub} 占位符
  description: string;
}

export const SEED_SOURCES: SeedSource[] = [
  // ── AI（人工智能论文 + 业界周报）──────────────────────────────────────────
  {
    name: 'HuggingFace Papers',
    category: InfoSourceCategory.ai,
    rssUrl: '{rsshub}/huggingface/daily-papers',
    description: 'AI 每日 trending 论文，社区投票',
  },
  {
    name: 'AlphaSignal',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://alphasignal.ai/feed',
    description: 'ML 工程师周报，含模型/GPU/代码动态',
  },
  {
    name: 'The Batch (DeepLearning.AI)',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://www.deeplearning.ai/the-batch/feed/',
    description: '吴恩达团队 AI 周报',
  },
  {
    name: 'Import AI (Jack Clark)',
    category: InfoSourceCategory.ai,
    rssUrl: 'https://importai.substack.com/feed',
    description: 'Anthropic 联创周报，AI 政策 + 前沿',
  },
  {
    name: 'arXiv cs.AI',
    category: InfoSourceCategory.ai,
    rssUrl: 'http://arxiv.org/rss/cs.AI',
    description: 'arXiv 人工智能预印本',
  },
  // 原 academic — arXiv AI 相关论文统一归 ai
  {
    name: 'arXiv cs.LG',
    category: InfoSourceCategory.ai,
    rssUrl: 'http://arxiv.org/rss/cs.LG',
    description: 'arXiv 机器学习预印本',
  },
  {
    name: 'arXiv cs.CL',
    category: InfoSourceCategory.ai,
    rssUrl: 'http://arxiv.org/rss/cs.CL',
    description: 'arXiv 计算语言学 / NLP',
  },

  // ── 工程（技术/编程，不分国内外，按主题归位）──────────────────────────────
  {
    name: 'Hacker News Frontpage',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://hnrss.org/frontpage',
    description: 'YC 系开发者每日必看',
  },
  {
    name: 'Lobsters',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://lobste.rs/rss',
    description: '邀请制小社区，技术纯度高、噪音低',
  },
  {
    name: 'dev.to',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://dev.to/feed',
    description: '开发者写作社区，教程类多',
  },
  {
    name: 'GitHub Trending (TypeScript)',
    category: InfoSourceCategory.engineering,
    rssUrl: '{rsshub}/github/trending/daily/typescript/en',
    description: '工程师在 star 什么的指标',
  },
  {
    name: 'The Pragmatic Engineer',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://newsletter.pragmaticengineer.com/feed',
    description: '工程文化 + 大厂内幕周报',
  },
  // 原 china_tech 中的技术社区 → engineering
  {
    name: 'V2EX 首页',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://www.v2ex.com/index.xml',
    description: '国内开发者讨论，质量高',
  },
  {
    name: '掘金 · 前端',
    category: InfoSourceCategory.engineering,
    rssUrl: '{rsshub}/juejin/category/frontend',
    description: '掘金前端版',
  },
  {
    name: '掘金 · 后端',
    category: InfoSourceCategory.engineering,
    rssUrl: '{rsshub}/juejin/category/backend',
    description: '掘金后端版',
  },
  {
    name: '少数派',
    category: InfoSourceCategory.engineering,
    rssUrl: 'https://sspai.com/feed',
    description: '工具 / 效率 / AI 工具沉淀厚',
  },

  // ── 商业（创投/策略/增长）────────────────────────────────────────────────
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
    description: 'Tyler Cowen 经济 / 文化日更博客',
  },
  // 原 china_tech 中的商业媒体 → business
  {
    name: '36氪快讯',
    category: InfoSourceCategory.business,
    rssUrl: '{rsshub}/36kr/newsflashes',
    description: '国内 TechCrunch，融资+创业全覆盖',
  },

  // ── 设计（UI/UX/视觉工程）────────────────────────────────────────────────
  {
    name: 'Sidebar',
    category: InfoSourceCategory.design,
    rssUrl: 'https://sidebar.io/feed.xml',
    description: '每日 5 条精选设计链接，零噪音',
  },
  {
    name: 'Smashing Magazine',
    category: InfoSourceCategory.design,
    rssUrl: 'https://www.smashingmagazine.com/feed/',
    description: '前端 + 设计工程老牌站',
  },

  // ── 思想 · 长文（原 reading）────────────────────────────────────────────
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
    description: '哲学 / 科学长文，编辑挑选',
  },
];

/** 把 seed URL 里的 {rsshub} 占位符替换成 RSSHUB_BASE_URL env 值 */
export function resolveSeedUrl(rssUrl: string): string {
  const rsshubBase = process.env.RSSHUB_BASE_URL || 'http://rsshub:1200';
  return rssUrl.replace(/\{rsshub\}/g, rsshubBase);
}
