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
    name: 'htmlTableToMarkdown',
    description: 'HTML <table> → GFM markdown 表格（处理 colspan/rowspan 扁平化）',
    transform: (md) => md.replace(/<table>[\s\S]*?<\/table>/gi, htmlTableToGfm),
  },

  {
    name: 'stripRemainingHtmlTags',
    description: '移除其他残留 HTML 标签（<op>、<span> 等 OCR/格式残留）',
    transform: (md) => md.replace(/<\/?(?:op|span)[^>]*>/gi, ''),
  },

  {
    name: 'obsidianHighlight',
    description: 'Obsidian 风格 ==highlight== → Plate 识别的 <mark> 标签',
    transform: (md) => md.replace(/==((?:[^=]|=[^=])+)==/g, '<mark>$1</mark>'),
  },

  /* latexBlockToCodeBlock / latexInlineToCode 已移除：
     前端已集成 @platejs/math + remark-math，
     $$...$$ 和 $...$ 由 Plate EquationPlugin 直接渲染为 KaTeX 公式。 */

  {
    name: 'escapeBracesOutsideCode',
    description: '转义 code block / inline code / LaTeX 公式外的 { }，防止 remarkMdx 静默截断',
    transform: (md) => {
      const lines = md.split('\n');
      const result: string[] = [];
      let inCodeBlock = false;
      let inBlockMath = false;

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
        // $$...$$ 块级公式可能跨行
        if (/^\$\$/.test(line.trim())) {
          inBlockMath = !inBlockMath;
          result.push(line);
          continue;
        }
        if (inBlockMath) {
          result.push(line);
          continue;
        }
        // 跳过 inline code `...` 和行内公式 $...$
        result.push(
          line.replace(/(`[^`]*`)|(\$[^$\n]+?\$)|([{}])/g, (_match, codeSpan, mathSpan, brace) => {
            if (codeSpan) return codeSpan;
            if (mathSpan) return mathSpan;
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

/* ========== HTML table → GFM markdown 转换 ========== */

/** 去除 HTML 标签，保留文本内容 */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * 将单个 <table>...</table> 转换为 GFM markdown 表格。
 * 处理 colspan/rowspan：
 * - colspan > 1：合并文本到第一列，后续列留空
 * - rowspan > 1：后续行对应列留空
 *
 * 单列表格（常见于 MinerU 把代码识别为表格）转成 code block。
 */
function htmlTableToGfm(tableHtml: string): string {
  // 提取所有行
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<t([dh])[^>]*?(?:colspan=["']?(\d+)["']?)?[^>]*?(?:rowspan=["']?(\d+)["']?)?[^>]*>([\s\S]*?)<\/t[dh]>/gi;

  const rows: string[][] = [];
  const maxCols = new Array(200).fill(0); // rowspan 占位追踪
  let rowIdx = 0;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    let colIdx = 0;
    let cellMatch: RegExpExecArray | null;

    // 跳过被 rowspan 占位的列
    while (maxCols[colIdx] > 0) {
      maxCols[colIdx]--;
      cells.push('');
      colIdx++;
    }

    // 重置 cellRegex
    cellRegex.lastIndex = 0;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      // 跳过 rowspan 占位列
      while (maxCols[colIdx] > 0) {
        maxCols[colIdx]--;
        cells.push('');
        colIdx++;
      }

      const colspan = parseInt(cellMatch[2] || '1', 10);
      const rowspan = parseInt(cellMatch[3] || '1', 10);
      const text = stripTags(cellMatch[4]).replace(/\|/g, '\\|').replace(/\n/g, ' ');

      cells.push(text);
      colIdx++;

      // colspan 填充空列
      for (let c = 1; c < colspan; c++) {
        cells.push('');
        colIdx++;
      }

      // rowspan 标记后续行占位
      if (rowspan > 1) {
        for (let r = 0; r < rowspan - 1; r++) {
          maxCols[colIdx - colspan] = (maxCols[colIdx - colspan] || 0) + 1;
        }
      }
    }

    rows.push(cells);
    rowIdx++;
  }

  if (rows.length === 0) return '';

  // 检测单列表格 → 转为 code block
  const colCount = Math.max(...rows.map((r) => r.length));
  if (colCount <= 1) {
    const lines = rows.map((r) => r[0] || '').filter(Boolean);
    return '\n```\n' + lines.join('\n') + '\n```\n';
  }

  // 对齐列数
  for (const row of rows) {
    while (row.length < colCount) row.push('');
  }

  // 构建 GFM 表格
  const header = '| ' + rows[0].join(' | ') + ' |';
  const separator = '| ' + rows[0].map(() => '---').join(' | ') + ' |';
  const body = rows
    .slice(1)
    .map((r) => '| ' + r.join(' | ') + ' |')
    .join('\n');

  return '\n' + header + '\n' + separator + '\n' + body + '\n';
}
