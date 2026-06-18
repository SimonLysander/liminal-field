/**
 * paste-cleanup — 把外部 HTML 清洗成纯 markdown
 *
 * 设计：用 turndown 这个业界成熟库做 HTML → markdown 转换。
 * 输出的 markdown 只含结构性语义（heading/list/link/code/strong/em/table），
 * 所有 inline style、class、扩展属性一律丢弃。
 *
 * 上限 50KB：超大 HTML 触发 turndown 同步阻塞，直接返回空让调用方走 text/plain 兜底。
 */
import TurndownService from 'turndown';

// 业界普遍认为 50KB 文本是单次粘贴的合理上限；超过基本是机器或意外
const MAX_HTML_BYTES = 50 * 1024;

const turndown = new TurndownService({
  headingStyle: 'atx',     // # ## ### —— 与 Plate markdown-kit 一致
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

// GFM 表格 / 任务列表 / 删除线 —— turndown 默认不支持，得加 plugin
// 如果实施时构建报错，下一行替换成：import gfm from 'turndown-plugin-gfm'; turndown.use(gfm);
// 项目允许不引入额外依赖时，先不装 plugin（GFM 表格落地为粗糙形式）；后续可补
// turndown.use(gfm);

export function htmlToCleanMarkdown(html: string): string {
  if (!html) return '';
  if (html.length > MAX_HTML_BYTES) return '';
  try {
    return turndown.turndown(html);
  } catch (err) {
    console.error('[paste-cleanup] turndown 转换失败:', err);
    return '';
  }
}
