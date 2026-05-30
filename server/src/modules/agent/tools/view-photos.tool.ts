import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';
import type { GalleryContext } from './gallery-context';

/**
 * view_photos —— 申请查看若干照片的画面本身。
 *
 * **图本身不在工具结果里返回**(openai-compatible 的 wire format 不让 tool 消息带图,GV3 实测)。
 * agent.service 的 prepareStep 会检测到本次调用,把这些 fileName 对应的图作为 base64
 * 注进下一步的 user message。本工具只校验 fileName 是否存在 + 回文本确认。
 */
export function createViewPhotosTool(
  getGallery: () => GalleryContext | undefined,
) {
  return tool({
    description:
      '查看若干照片的画面本身(传 fileName 数组)。调用后这些照片会出现在你接下来能看到的内容里,据此写图说。只传你确实要看的,别一次全要。',
    inputSchema: jsonSchema<{ fileNames: string[] }>({
      type: 'object',
      properties: {
        fileNames: {
          type: 'array',
          items: { type: 'string' },
          description: '要看的照片 fileName 列表',
        },
      },
      required: ['fileNames'],
    }),
    execute: ({ fileNames }: { fileNames: string[] }) => {
      const g = getGallery();
      if (!g)
        return toolResult('当前没有打开的画廊草稿', undefined, {
          status: 'not_found',
        });
      const known = new Set(g.photos.map((p) => p.fileName));
      const list = Array.isArray(fileNames) ? fileNames : [];
      const requested = list.filter((f) => known.has(f));
      const missing = list.filter((f) => !known.has(f));
      const summary = requested.length
        ? `已调取 ${requested.length} 张,见随后画面${missing.length ? `;${missing.length} 张不存在` : ''}`
        : '没有可调取的照片(fileName 都不存在)';
      return toolResult(summary, undefined, {
        status: 'ok',
        requested,
        missing,
      });
    },
  });
}
