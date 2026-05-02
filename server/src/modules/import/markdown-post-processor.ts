/**
 * MarkdownPostProcessor — 导入 markdown 的后处理管道
 *
 * 将外部来源（MinerU、用户上传的 .md）的 markdown 适配为 Plate 可安全渲染的格式。
 * 每个规则独立可测试，按顺序执行。规则顺序有依赖：
 *   1. HTML → markdown 转换必须在 LaTeX 处理之前（避免 <img> 里的 $ 被误匹配）
 *   2. 花括号转义必须在所有 inline code 生成之后（避免转义 code 内的花括号）
 *   3. 空行收窄放最后（前面的规则可能产生多余空行）
 */

/**
 * 对 markdown 执行全部后处理规则。
 * 每个规则是纯函数，输入 markdown 输出 markdown。
 */
export function processMarkdown(markdown: string): string {
  let md = markdown;
  for (const rule of rules) {
    md = rule.transform(md);
  }
  return md;
}

/** 单条后处理规则 */
interface PostProcessRule {
  /** 规则名称，用于日志和调试 */
  name: string;
  /** 规则说明 */
  description: string;
  /** 转换函数 */
  transform: (markdown: string) => string;
}

/**
 * 规则列表——按执行顺序排列。
 * 新增规则时注意：
 * - 插入到正确的位置（参考文件头部的顺序说明）
 * - 保持每个规则只做一件事
 * - 写清楚 description，说明为什么需要这个转换
 */
const rules: PostProcessRule[] = [
  {
    name: 'normalizeHeadingLevels',
    description: '标题层级归一化：找到最小级别，整体前移到 h1 开始',
    transform: (md) => {
      const headingRegex = /^(#{1,6})\s/gm;
      let minLevel = 7;
      let match: RegExpExecArray | null;
      while ((match = headingRegex.exec(md)) !== null) {
        minLevel = Math.min(minLevel, match[1].length);
      }
      if (minLevel <= 1 || minLevel > 6) return md;
      const shift = minLevel - 1;
      return md.replace(/^(#{1,6})\s/gm, (_, hashes: string) => {
        const newLevel = Math.max(1, hashes.length - shift);
        return '#'.repeat(newLevel) + ' ';
      });
    },
  },

  {
    name: 'htmlImgToMarkdown',
    description: 'HTML <img> → markdown 图片语法（MinerU 有时输出 HTML 而非标准 md）',
    transform: (md) =>
      md.replace(/<img[^>]+src=["']([^"']+)["'][^>]*\/?>/gi, (_, src) => `![](${src})`),
  },

  {
    name: 'stripHtmlDivs',
    description: '移除包裹图片的 HTML <div> 容器',
    transform: (md) => md.replace(/<\/?div[^>]*>/gi, ''),
  },

  {
    name: 'obsidianHighlight',
    description: 'Obsidian 风格 ==highlight== → Plate 识别的 <mark> 标签',
    transform: (md) => md.replace(/==((?:[^=]|=[^=])+)==/g, '<mark>$1</mark>'),
  },

  {
    name: 'latexBlockToCodeBlock',
    description: '块级 LaTeX $$...$$ → fenced code block（Plate 不支持 LaTeX 渲染）',
    transform: (md) =>
      md.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => '\n```\n' + tex.trim() + '\n```\n'),
  },

  {
    name: 'latexInlineToCode',
    description: '行内 LaTeX $...$ → inline code',
    transform: (md) => md.replace(/\$([^\n$]+?)\$/g, '`$1`'),
  },

  {
    name: 'escapeBracesOutsideCode',
    description: '转义 code block / inline code 外的 { }，防止 remarkMdx 静默截断',
    transform: (md) => {
      const lines = md.split('\n');
      const result: string[] = [];
      let inCodeBlock = false;

      for (const line of lines) {
        if (/^```/.test(line)) {
          inCodeBlock = !inCodeBlock;
          result.push(line);
          continue;
        }
        if (inCodeBlock) {
          result.push(line);
          continue;
        }
        result.push(
          line.replace(/(`[^`]*`)|([{}])/g, (_match, codeSpan, brace) => {
            if (codeSpan) return codeSpan;
            return brace === '{' ? '\\{' : '\\}';
          }),
        );
      }
      return result.join('\n');
    },
  },

  {
    name: 'collapseBlankLines',
    description: '连续 3+ 空行压缩为 2 行，保留段落间距',
    transform: (md) => md.replace(/\n{3,}/g, '\n\n'),
  },
];
