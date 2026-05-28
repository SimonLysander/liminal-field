import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';
import type { GalleryContext } from './gallery-context';

/**
 * get_current_draft —— 画廊版。从 entryContext.gallery read 出随笔 + 照片清单。
 *
 * 模型据此知道有哪些照片、现有图说;要看图本身再调 view_photos。
 * 无 bodyHash(图说短、直替,不走 hash 强校验)。工厂收 lazy getter,与文稿版签名一致。
 */
export function createGetGalleryDraftTool(
  getGallery: () => GalleryContext | undefined,
) {
  return tool({
    description:
      '读取当前画廊草稿:返回随笔 + 全部照片清单(序号/fileName/现有图说/拍摄参数 tags)。要看某张照片的画面本身,用 view_photos 传它的 fileName。',
    inputSchema: jsonSchema<Record<string, never>>({
      type: 'object',
      properties: {},
    }),
    execute: () => {
      const g = getGallery();
      if (!g)
        return toolResult('当前没有打开的画廊草稿', undefined, {
          status: 'not_found',
        });
      const lines = g.photos.map((p) => {
        const tagStr = Object.entries(p.tags ?? {})
          .map(([k, v]) => `${k}:${v}`)
          .join(' ');
        return `  [${p.index}] ${p.fileName} | 图说:${p.caption || '(空)'}${tagStr ? ` | ${tagStr}` : ''}`;
      });
      const detail = [
        `画廊《${g.title || '未命名'}》,共 ${g.photos.length} 张照片`,
        `随笔:\n${g.prose || '(空)'}`,
        `照片清单:\n${lines.join('\n')}`,
      ].join('\n\n');
      return toolResult(
        `《${g.title || '画廊'}》 · ${g.photos.length} 张`,
        detail,
        {
          status: 'ok',
          contentItemId: g.contentItemId,
          photoCount: g.photos.length,
        },
      );
    },
  });
}
