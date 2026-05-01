import { MarkdownPlugin, remarkMdx } from '@platejs/markdown';
import remarkGfm from 'remark-gfm';

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      remarkPlugins: [
        remarkGfm,
        remarkMdx, // 解析 inline HTML/JSX（font-size span、date 标签等）
      ],
    },
  }),
];
