import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';
import type { GalleryContext } from './gallery-context';

/**
 * 图说硬上限 30 字——"极其克制"是沉浸式画廊的核心:一句白描点睛足矣。
 * 跟前端 PhotoEditModal textarea 的 maxLength={30} 一致,
 * 跟 system prompt 的"30 字内"指示一致(双重保险)。
 */
const MAX_CAPTION = 30;

/**
 * propose_caption —— 为单张照片提议图说(caption)。
 *
 * 前端读 meta.{fileName,caption} 渲染「应用」按钮,点击落到 useGalleryEditor.updateCaption。
 * 短文案不做 diff、不做 bodyHash 校验(对比 propose_document_rewrite 的长正文强校验)。
 */
export function createProposeCaptionTool(
  getGallery: () => GalleryContext | undefined,
) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
    inputSchema: jsonSchema<{
      fileName: string;
      caption: string;
      reason?: string;
    }>({
      type: 'object',
      properties: {
        fileName: { type: 'string', description: '目标照片 fileName' },
        caption: { type: 'string', description: '提议的图说文案' },
        reason: { type: 'string', description: '可选:为什么这样写' },
      },
      required: ['fileName', 'caption'],
    }),
    execute: ({
      fileName,
      caption,
      reason,
    }: {
      fileName: string;
      caption: string;
      reason?: string;
    }) => {
      if (
        typeof caption !== 'string' ||
        caption.trim().length === 0 ||
        caption.length > MAX_CAPTION
      )
        return toolResult('图说为空或过长', undefined, {
          status: 'invalid',
          fileName,
        });
      const g = getGallery();
      if (!g)
        return toolResult('当前没有打开的画廊草稿', undefined, {
          status: 'invalid',
        });
      if (!g.photos.some((p) => p.fileName === fileName))
        return toolResult('该照片不存在', undefined, {
          status: 'not_found',
          fileName,
        });
      return toolResult('已为照片提议图说', undefined, {
        status: 'ok',
        fileName,
        caption: caption.trim(),
        reason: reason ?? '',
      });
    },
  });
}
