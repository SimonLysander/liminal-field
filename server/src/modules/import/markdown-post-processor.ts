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
    name: 'normalizeLineEndings',
    description:
      '统一导入文本行尾为 LF，避免 CRLF 残留的 \\r 干扰公式围栏和块级语法识别',
    transform: (md) => md.replace(/\r\n?/g, '\n'),
  },

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
    name: 'unwrapGeneratedBlockquotes',
    description:
      '清理批量导入/转换产物中误加在标题、表格、公式、图片前的 >，避免后续内容被整段渲染成引用块',
    transform: (md) => {
      const lines = md.split('\n');
      const nonBlankLines = lines.filter((line) => line.trim().length > 0);
      const quotedLines = nonBlankLines.filter((line) => /^\s*>\s?/.test(line));
      if (quotedLines.length < 3 || nonBlankLines.length < 6) return md;

      // 只处理“整篇几乎都被转换器套上 >”的情况；零散引用块是作者语义，必须保留。
      if (quotedLines.length / nonBlankLines.length < 0.6) return md;

      const structuralQuotedLines = quotedLines.filter((line) => {
        const content = line.replace(/^\s*>\s?/, '').trimStart();
        return (
          /^#{1,6}\s/.test(content) ||
          /^\|.*\|$/.test(content) ||
          /^!\[[^\]]*\]\([^)]+\)/.test(content) ||
          /^\$\$/.test(content) ||
          /^\d+\.\s/.test(content) ||
          /^[-*+]\s/.test(content) ||
          /^```/.test(content)
        );
      });

      if (
        structuralQuotedLines.length < 3 &&
        structuralQuotedLines.length / quotedLines.length < 0.35
      ) {
        return md;
      }

      return lines
        .map((line) => line.replace(/^(\s*)>\s?/, '$1'))
        .join('\n');
    },
  },

  {
    name: 'htmlImgToMarkdown',
    description:
      'HTML <img> → markdown 图片语法（MinerU 有时输出 HTML 而非标准 md）',
    transform: (md) =>
      md.replace(
        /<img[^>]+src=["']([^"']+)["'][^>]*\/?>/gi,
        (_, src) => `![](${src})`,
      ),
  },

  {
    name: 'stripHtmlDivs',
    description: '移除包裹图片的 HTML <div> 容器',
    transform: (md) => md.replace(/<\/?div[^>]*>/gi, ''),
  },

  {
    name: 'htmlTableToMarkdown',
    description:
      'HTML <table> → GFM markdown 表格（处理 colspan/rowspan 扁平化）',
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
    transform: (md) => {
      const lines = md.split('\n');
      let inCodeBlock = false;
      return lines
        .map((line) => {
          if (/^```/.test(line)) {
            inCodeBlock = !inCodeBlock;
            return line;
          }
          if (inCodeBlock) return line;
          return line.replace(/==((?:[^=]|=[^=])+)==/g, '<mark>$1</mark>');
        })
        .join('\n');
    },
  },

  /* latexBlockToCodeBlock / latexInlineToCode 已移除：
     前端已集成 @platejs/math + remark-math，
     $$...$$ 和 $...$ 由 Plate EquationPlugin 直接渲染为 KaTeX 公式。 */

  {
    name: 'fixPipesInTableMath',
    description:
      '表格内 $...$ 公式里的 | 替换为 \\vert，避免与表格列分隔符冲突',
    transform: (md: string) => {
      return md.replace(/^(\|.*\|)$/gm, (tableLine: string) => {
        // 只处理表格行（以 | 开头和结尾的行，排除分隔行 |---|）
        if (/^\|[\s-:|]+\|$/.test(tableLine)) return tableLine;
        // 替换表格行内 $...$ 公式中的 |
        return tableLine.replace(
          /\$([^$\n]+?)\$/g,
          (_match: string, texContent: string) => {
            return (
              '$' +
              texContent.replace(/\\\|/g, '\\vert ').replace(/\|/g, '\\vert ') +
              '$'
            );
          },
        );
      });
    },
  },

  {
    name: 'isolateBlockMathFences',
    description:
      'remark-math 要求 $$ 独占一行且开闭在同一层级；修复 blockquote 内的粘连和层级不匹配',
    transform: (md) => {
      const lines = md.split('\n');
      const result: string[] = [];
      let openPrefix: string | null = null; // 当前未闭合 $$ 所在的 blockquote 层级前缀

      for (const line of lines) {
        // 提取 blockquote 前缀（如 "> " 或 "> > "）
        const prefixMatch = line.match(/^((?:>\s*)*)/);
        const prefix = prefixMatch ? prefixMatch[1] : '';
        const content = line.slice(prefix.length);
        const trimmedContent = content.trim();

        if (openPrefix === null) {
          // 未在 $$ 块内
          if (trimmedContent.startsWith('$$')) {
            const leadingWhitespace = content.match(/^\s*/)?.[0] ?? '';
            const mathPrefix = prefix + leadingWhitespace;
            const afterDollar = content.slice(content.indexOf('$$') + 2);
            const afterTrimmed = afterDollar.trim();
            if (afterTrimmed === '') {
              // 独立的 $$ 开头行
              openPrefix = mathPrefix;
              result.push(line);
            } else if (afterTrimmed.endsWith('$$')) {
              // $$content$$ 单行块统一拆成三行，避免 Plate/remark 在 CRLF 或前后空格下误吞后续内容。
              const expression = afterTrimmed.slice(0, -2).trim();
              result.push(mathPrefix + '$$');
              if (expression) result.push(mathPrefix + expression);
              result.push(mathPrefix + '$$');
            } else {
              // $$content（粘连）→ 拆为 prefix+$$ 和 prefix+content
              openPrefix = mathPrefix;
              result.push(mathPrefix + '$$');
              result.push(mathPrefix + afterDollar.trimStart());
            }
          } else {
            result.push(line);
          }
        } else {
          // 在 $$ 块内，寻找闭合 $$
          if (trimmedContent === '$$') {
            // 闭合 $$：确保与开头同级前缀
            result.push(openPrefix + '$$');
            openPrefix = null;
          } else if (trimmedContent.endsWith('$$')) {
            // content$$（粘连闭合）→ 拆为 prefix+content 和 prefix+$$
            result.push(openPrefix + trimmedContent.slice(0, -2).trimEnd());
            result.push(openPrefix + '$$');
            openPrefix = null;
          } else {
            // 块内内容行：统一使用开头的前缀
            result.push(openPrefix + content.trimStart());
          }
        }
      }

      return result.join('\n');
    },
  },

  {
    name: 'escapeBracesOutsideCode',
    description:
      '转义 code block / inline code / LaTeX 公式外的 { }，防止 remarkMdx 静默截断',
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
        // $$...$$ 块级公式可能跨行：检测行中任意位置的 $$
        const dollarPairs = (line.match(/\$\$/g) || []).length;
        if (dollarPairs > 0) {
          // 奇数个 $$ → 切换状态（开或关），偶数个 → 不变（同行开关）
          if (dollarPairs % 2 === 1) inBlockMath = !inBlockMath;
          result.push(line);
          continue;
        }
        if (inBlockMath) {
          result.push(line);
          continue;
        }
        // 跳过 inline code `...` 和行内公式 $...$
        result.push(
          line.replace(
            /(`[^`]*`)|(\$[^$\n]+?\$)|([{}])/g,
            (
              _match: string,
              codeSpan: string,
              mathSpan: string,
              brace: string,
            ) => {
              if (codeSpan) return codeSpan;
              if (mathSpan) return mathSpan;
              return brace === '{' ? '\\{' : '\\}';
            },
          ),
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
  const cellRegex =
    /<t([dh])[^>]*?(?:colspan=["']?(\d+)["']?)?[^>]*?(?:rowspan=["']?(\d+)["']?)?[^>]*>([\s\S]*?)<\/t[dh]>/gi;

  const rows: string[][] = [];
  // new Array(n).fill(0) 在 TS 下常为 any[]，会拖累 maxCols[col] 赋值的类型推断
  const maxCols: number[] = Array.from({ length: 200 }, () => 0); // rowspan 占位追踪
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1] ?? '';
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

      const colspan = Number.parseInt(cellMatch[2] ?? '1', 10);
      const rowspan = Number.parseInt(cellMatch[3] ?? '1', 10);
      const text = stripTags(cellMatch[4] ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ');

      cells.push(text);
      colIdx++;

      // colspan 填充空列
      for (let c = 1; c < colspan; c++) {
        cells.push('');
        colIdx++;
      }

      // rowspan 标记后续行占位
      if (rowspan > 1) {
        const anchorCol: number = colIdx - colspan;
        for (let r = 0; r < rowspan - 1; r++) {
          maxCols[anchorCol] = (maxCols[anchorCol] ?? 0) + 1;
        }
      }
    }

    rows.push(cells);
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
