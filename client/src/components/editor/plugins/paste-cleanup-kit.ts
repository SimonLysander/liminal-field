/**
 * PasteCleanupKit — 接管 Plate 默认 HTML paste，走 turndown 清洗
 *
 * 设计：
 *   - clipboardData.files.length > 0  →  放行（让 Plate media paste 接管图片）
 *   - HTML 含 <pre>（代码块场景）   →  优先用 text/plain 包成 markdown ```fence``` 灌入，
 *                                       保留原始缩进（turndown 对带语法高亮 span 的 pre
 *                                       处理有 quirks，会丢缩进）
 *   - 含 'text/html'                →  HTML → markdown → deserializeMd → 灌入
 *   - 其他（纯文本 / markdown 源码） →  放行（保留 Plate inputRules）
 *
 * 注意：Plate 53 的 onPaste handler 拿到的是 React.ClipboardEvent，
 * React.ClipboardEvent 上已有 clipboardData 属性，不需要额外类型转换。
 */
'use client';

import { deserializeMd } from '@platejs/markdown';
import { common, createLowlight } from 'lowlight';
import { createPlatePlugin } from 'platejs/react';

import { htmlToCleanMarkdown } from '@/lib/paste-cleanup';

export const LIMINAL_FRAGMENT_MIME = 'application/x-liminal-field-fragment';
const SLATE_FRAGMENT_MIME = 'application/x-slate-fragment';

/* 语言自动识别：lowlight 已是项目依赖（被 Plate code-block 高亮链路用），
 * 走 common 包覆盖 ~30 种常见语言（TS / Py / Go / Rust / Java / SQL / Bash 等），
 * bundle 影响为零（实例复用）。 */
const lowlight = createLowlight(common);
type PlateFragmentNode = Record<string, unknown> &
  ({ children: PlateFragmentNode[] } | { text: string });
type PlateFragment = PlateFragmentNode[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlateNode(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return Array.isArray(value.children) || typeof value.text === 'string';
}

export function encodeInternalFragment(fragment: unknown): string {
  return JSON.stringify(fragment);
}

export function decodeInternalFragment(raw: string): PlateFragment | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isPlateNode)) return null;
    return parsed as PlateFragment;
  } catch {
    return null;
  }
}

export function hasSlateInternalFragment(types: string[], html: string): boolean {
  return types.includes(SLATE_FRAGMENT_MIME) || /data-slate-fragment="[^"]+"/i.test(html);
}

/** 从 IDE 的 <pre> / <code> 标签 class 里抽语言提示（"language-ts" / "lang-py" 等） */
function extractCodeLang(html: string): string {
  const m = html.match(/<(?:pre|code)[^>]*class="[^"]*\b(?:language|lang)-([\w-]+)/i);
  return m?.[1] ?? '';
}

/** 用 highlight.js 内容嗅探猜语言；返回空表示识别不出，让代码块走 Plain Text。
 * 太短的片段（< 24 字符）不嗅探：噪音大、容易误判。 */
function detectCodeLang(code: string): string {
  if (code.length < 24) return '';
  try {
    const r = lowlight.highlightAuto(code);
    return r.data?.language ?? '';
  } catch {
    return '';
  }
}

/** 检测 HTML 是否来自代码编辑器（VS Code / Cursor / JetBrains 等）。
 *
 * 这里必须偏保守：Plate/浏览器复制普通段落时也可能带 pre-wrap 或 monospace，
 * 如果仅凭这些样式判断，会把用户自己的文字误包成 ``` fence。
 */
export function isCodePasteSource(html: string): boolean {
  if (!html) return false;
  if (
    /\b(?:vscode|monaco|cm-line|cm-content|CodeMirror|hljs|prism|token|shiki|ace_line|ace_text-layer)\b/i.test(
      html,
    )
  ) {
    return true;
  }
  if (/<pre[\s\S]*<code[\s>]/i.test(html)) return true;
  if (/<(?:pre|code)[^>]*class="[^"]*\b(?:language|lang)-[\w-]+/i.test(html)) {
    return true;
  }
  return false;
}

export const PasteCleanupPlugin = createPlatePlugin({
  key: 'paste-cleanup',
}).extend({
  handlers: {
    onCopy: ({ editor, event }) => {
      const data = event.clipboardData;
      const selection = editor.selection;
      if (!data || !selection) return;

      const fragment = editor.api.fragment();
      if (!fragment || fragment.length === 0) return;

      data.setData(LIMINAL_FRAGMENT_MIME, encodeInternalFragment(fragment));
    },
    onPaste: ({ editor, event }) => {
      const data = event.clipboardData;
      if (!data) return;

      // 1) 图片/文件 paste —— 放行给 Plate media paste handler
      if (data.files && data.files.length > 0) return;

      const types = Array.from(data.types || []);
      const html = types.includes('text/html') ? data.getData('text/html') : '';

      // 2) Slate/Plate 内部复制 —— 放行给编辑器原生 fragment 管线。
      // Slate 已经会写 application/x-slate-fragment + data-slate-fragment，
      // 让它自己恢复节点，保真度最高；这里不能抢先走 HTML → Markdown 清洗。
      if (hasSlateInternalFragment(types, html)) return;

      // 3) 我们的内部复制兜底 —— 直接插 Plate 节点片段，避免 HTML/Markdown 往返丢结构。
      if (types.includes(LIMINAL_FRAGMENT_MIME)) {
        const fragment = decodeInternalFragment(data.getData(LIMINAL_FRAGMENT_MIME));
        if (fragment?.length) {
          event.preventDefault();
          editor.tf.insertFragment(fragment as Parameters<typeof editor.tf.insertFragment>[0]);
          return;
        }
      }

      // 4) 无 HTML —— 走 Plate 默认 paste（保留 inputRules / autolink）
      if (!types.includes('text/html')) return;

      // 5) 代码块场景。turndown 对带语法高亮 span 的 pre / div 会丢缩进，
      //    甚至连 code block 语义都丢；这里走 fence 直插。
      //
      //    数据源优先级：
      //    a. DOM 解析 <pre>.textContent  —— 适配 GitHub / 文档站 / 浏览器复制
      //    b. text/plain                  —— 适配 Cursor / VS Code（Monaco 用
      //                                       <div> 不用 <pre>，DOM 拿不到代码体；
      //                                       Monaco 复制的 text/plain 是源码本身，
      //                                       缩进 / 换行完整保留）
      //
      //    语言识别：HTML class 提示优先 → lowlight 内容嗅探兜底
      if (isCodePasteSource(html)) {
        let preText = '';
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const pre = doc.querySelector('pre');
          if (pre) preText = pre.textContent ?? '';
        } catch (err) {
          console.error('[paste-cleanup] DOM 解析失败，回落到 text/plain:', err);
        }
        if (!preText) preText = data.getData('text/plain');

        if (preText) {
          const lang = extractCodeLang(html) || detectCodeLang(preText);
          const fenced = '```' + lang + '\n' + preText + '\n```';
          try {
            const nodes = deserializeMd(editor, fenced);
            if (nodes?.length) {
              event.preventDefault();
              editor.tf.insertFragment(nodes);
              return;
            }
          } catch (err) {
            console.error('[paste-cleanup] code fence 失败，退回 turndown 链路:', err);
          }
        }
      }

      const markdown = htmlToCleanMarkdown(html);

      // 6) 清洗失败或返回空 —— 让 Plate 默认 paste 接管（不阻断用户操作）
      if (!markdown) return;

      try {
        const nodes = deserializeMd(editor, markdown);
        if (!nodes || nodes.length === 0) return;
        event.preventDefault();
        editor.tf.insertFragment(nodes);
      } catch (err) {
        console.error('[paste-cleanup] deserializeMd 失败，退回默认 paste:', err);
      }
    },
  },
});

export const PasteCleanupKit = [PasteCleanupPlugin];
