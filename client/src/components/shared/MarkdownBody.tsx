/*
 * MarkdownBody — 共享 markdown 只读渲染组件
 *
 * 内部使用 Plate read-only 模式渲染，与编辑器共享同一套插件和组件，
 * 确保编辑端和展示端视觉 100% 一致。
 *
 * 使用场景：
 *   - 笔记阅读器 (NotePage)：正文 + TOC 滚动定位
 *   - 管理端内容预览 (ContentVersionView)：版本正文预览
 *   - 导入预览页 (ImportPreviewPage)：导入前预览
 *
 * heading 元素自动标记 data-heading-id 属性，供 TOC 面板提取目录。
 * Plate 异步解析完成后会触发 onHeadingsMarked，便于父组件从 DOM 聚合 TOC。
 */

import { memo } from 'react';
import PlateReadOnly from './PlateReadOnly';

const MarkdownBody = memo(function MarkdownBody({
  markdown,
  contentItemId,
  onHeadingsMarked,
}: {
  markdown: string;
  /** 传入后会将 ./assets/{name} 改写为服务端代理 URL */
  contentItemId?: string;
  /** Plate 为标题打上 data-heading-id 后调用（例如导入预览页刷新大纲） */
  onHeadingsMarked?: () => void;
}) {
  return (
    <PlateReadOnly
      markdown={markdown}
      contentItemId={contentItemId}
      onHeadingsMarked={onHeadingsMarked}
    />
  );
});

export default MarkdownBody;
