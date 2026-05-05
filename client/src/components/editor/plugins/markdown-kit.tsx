import { MarkdownPlugin, remarkMdx } from '@platejs/markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      remarkPlugins: [
        remarkGfm,
        remarkMath, // 解析 $...$ 行内公式和 $$...$$ 块级公式
        remarkMdx, // 解析 inline HTML/JSX（font-size span、date 标签等）
      ],
    },
  }),
];
