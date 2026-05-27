import { tool, jsonSchema } from 'ai';
// 注:这里去掉 `.js` 后缀以便 jest 默认 resolver 能解析(原来的 `.js` ESM 风格
// 在 jest CJS 模式下找不到模块,导致单测无法 import 本文件)。runtime 上 SWC 输出
// CJS,无后缀也能正确解析。read-content.tool.ts 仍是 `.js`,留待后续统一。
import { extractHeadings } from './markdown.utils';
import { toolResult } from './tool-result';
import { computeBodyHash } from './body-hash.utils';

const DEFAULT_CHUNK = 6000;

export interface DocumentContext {
  contentItemId: string;
  title: string;
  bodyMarkdown: string;
  /** 前端已提取的标题列表(复用大纲面板逻辑) */
  outline?: string[];
}

/**
 * get_current_draft — 读取当前正在编辑的草稿(与 read_document_content 同策略)。
 *
 * 工厂收 lazy getter 而非快照值:草稿在 chat 会话期间可能被用户手动编辑,getter
 * 每次 execute 重读当前最新 markdown,避免 stale closure。
 *
 * 返回:
 *   - bodyHash:sha256(bodyMarkdown) 前 16 字符,供 propose_document_rewrite 强校验
 *   - 大纲全给 + 正文按 offset/limit chunk;body 用 cat -n 行号前缀(每行 "  N\t…")让模型有定位坐标
 *   - hasMore + nextOffset 引导续读
 *   - 无草稿 → status:not_found
 */
export function createGetCurrentDraftTool(
  getDocument: () => DocumentContext | undefined,
) {
  return tool({
    description:
      '读取当前正在编辑的草稿。返回大纲(全)+ 从 offset 起的一段正文(默认约 6000 字),很长时带"还有更多"用 offset 续读。返回 meta.bodyHash 必须在调用 propose_document_rewrite 时作为 bodyHash 参数传回。**调 propose_document_rewrite 之前必须先调本工具拿到 bodyHash。**',
    inputSchema: jsonSchema<{ offset?: number; limit?: number }>({
      type: 'object',
      properties: {
        offset: { type: 'number', description: '从第几个字符起读,默认 0' },
        limit: { type: 'number', description: '本次最多读多少字,默认 6000' },
      },
    }),
    execute: ({
      offset = 0,
      limit = DEFAULT_CHUNK,
    }: {
      offset?: number;
      limit?: number;
    }) => {
      const document = getDocument();
      if (!document)
        return toolResult('当前没有打开的草稿', undefined, {
          status: 'not_found',
        });

      const full = document.bodyMarkdown;
      const total = full.length;

      // 把 offset 自动对齐到行首:模型续读时给的 offset 可能正好落在某行中间
      // (比如上一次返回的 nextOffset = offset + limit 是按字符算的)。若不对齐,
      // chunk 第一行渲染会是行尾片段,但行号显示为完整行号 → 模型按"第 N 行"
      // 引用时错位。lastIndexOf('\n', offset-1)+1 找上一个 \n 之后的位置,即行首。
      const alignedOffset =
        offset > 0 ? full.lastIndexOf('\n', offset - 1) + 1 : 0;
      const chunk = full.slice(alignedOffset, alignedOffset + limit);
      const hasMore = alignedOffset + limit < total;
      const outline = document.outline ?? extractHeadings(full);
      const paragraphs = full
        .split(/\n\s*\n/)
        .filter((p) => p.trim().length > 0).length;
      const bodyHash = computeBodyHash(full);

      // body 加 cat -n 行号前缀:每行 "  N\t<text>",模型可引用"第 N 行"
      const startLine = full.slice(0, alignedOffset).split('\n').length;
      const chunkLines = chunk.split('\n');
      const numberedBody = chunkLines
        .map((line, i) => `${(startLine + i).toString().padStart(4)}\t${line}`)
        .join('\n');

      const sizeStr =
        total >= 10000 ? `${(total / 10000).toFixed(1)} 万字` : `${total} 字`;
      const endLine = startLine + chunkLines.length - 1;
      const summaryBits = [
        `《${document.title || '当前草稿'}》`,
        sizeStr,
        `读了第 ${startLine}–${endLine} 行`,
      ];

      const detail = [
        `# ${document.title}`,
        outline.length > 0
          ? `大纲:\n${outline.map((h) => `  ${h}`).join('\n')}`
          : '',
        `正文(${alignedOffset}–${alignedOffset + chunk.length} / 共 ${total}):\n${numberedBody}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      return toolResult(summaryBits.join(' · '), detail, {
        status: 'ok',
        contentItemId: document.contentItemId,
        bodyHash,
        wordCount: total,
        paragraphs,
        outlineCount: outline.length,
        offset,
        alignedOffset, // 实际起点(行首对齐):API 层面 offset 保留传入值,这里告诉调用者真实读取起点
        shown: chunk.length,
        hasMore,
        ...(hasMore ? { nextOffset: alignedOffset + limit } : {}),
      });
    },
  });
}
