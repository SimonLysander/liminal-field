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
 */

import { memo } from 'react';
import PlateReadOnly from './PlateReadOnly';

const MarkdownBody = memo(function MarkdownBody({
  markdown,
  contentItemId,
}: {
  markdown: string;
  /** 传入后会将 ./assets/{name} 改写为服务端代理 URL */
  contentItemId?: string;
}) {
  return <PlateReadOnly markdown={markdown} contentItemId={contentItemId} />;
});

export default MarkdownBody;
