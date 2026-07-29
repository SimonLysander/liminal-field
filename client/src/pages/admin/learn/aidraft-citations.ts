import type { Nodes } from 'mdast';
import type { Descendant } from 'platejs';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import {
  encodeInternalFragment,
  LIMINAL_FRAGMENT_MIME,
} from '@/components/editor/plugins/paste-cleanup-kit';

interface AidraftSourceRef {
  title: string;
  url: string;
}

const SOURCE_HEADING = '\n## 来源\n';
const SOURCE_LINE_RE = /^(\d+)\.\s+\[([^\]]+)\]\(([^)]+)\)\s*$/gm;
const INLINE_NUMERIC_LINK_RE = /\[(\d+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LEGACY_FOOTNOTE_RE = /\[\^(\d+)\](?!:)/g;
const RAW_CITATION_MARKER_RE =
  /\[@#CIT\s+\d+(?:\s*(?:,\s*\d+|-\s*\d+))*\]/gi;
const CITATION_ANCHOR_SELECTOR = 'a[href*="#cit-"]';
const PLATE_VOID_ELEMENT_SELECTOR =
  '[data-slate-node="element"][data-slate-void="true"]';
const TEX_ANNOTATION_SELECTOR = 'annotation[encoding="application/x-tex"]';
const markdownParser = unified().use(remarkParse);
type TextRange = { start: number; end: number };

function stripCitationFragment(url: string): string {
  return url.replace(/#cit-\d+$/, '');
}

function escapeMarkdownTitle(title: string): string {
  return title.replace(/[\\"]/g, '');
}

export function findClosestCitationAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  const node =
    target instanceof Element
      ? target
      : target instanceof Text
        ? target.parentElement
        : null;
  const anchor = node?.closest('a');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  return anchor.getAttribute('href')?.includes('#cit-') ? anchor : null;
}

/**
 * 复制 AI 初稿时移除正文的 citation 角标；文末来源清单仍是内容的一部分，不能删除。
 * 同时兼容已渲染为链接的新版正文与历史草稿中的原始 [@#CIT N] 标记。
 */
export function removeAidraftCitationMarkers(markdown: string): string {
  const ranges: TextRange[] = [];
  const collectCitationRanges = (node: Nodes) => {
    if (
      node.type === 'link' &&
      node.url.includes('#cit-') &&
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
    ) {
      ranges.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
      });
      return;
    }
    if ('children' in node) {
      node.children.forEach(collectCitationRanges);
    }
  };

  collectCitationRanges(markdownParser.parse(markdown));
  for (const match of markdown.matchAll(RAW_CITATION_MARKER_RE)) {
    if (match.index === undefined) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  const mergedRanges = ranges
    .sort((a, b) => a.start - b.start)
    .reduce<TextRange[]>((merged, range) => {
      const previous = merged.at(-1);
      if (
        previous &&
        /^[ \t]*(?:[,，、][ \t]*)?$/.test(
          markdown.slice(previous.end, range.start),
        )
      ) {
        previous.end = range.end;
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, [])
    .map((range) => {
      let whitespaceStart = range.start;
      let whitespaceEnd = range.end;
      while (
        whitespaceStart > 0 &&
        /[ \t\u00a0]/.test(markdown[whitespaceStart - 1])
      ) {
        whitespaceStart -= 1;
      }
      while (
        whitespaceEnd < markdown.length &&
        /[ \t\u00a0]/.test(markdown[whitespaceEnd])
      ) {
        whitespaceEnd += 1;
      }

      const next = markdown[whitespaceEnd];
      if (
        next === undefined ||
        /[\r\n，。！？；：、,.!?;:]/.test(next)
      ) {
        return { start: whitespaceStart, end: whitespaceEnd };
      }

      // 引用夹在两个词语之间时，保留左侧已有空格、删除右侧空格，
      // 使删除后的文本仍有且只有一个词间分隔。
      if (whitespaceStart < range.start && whitespaceEnd > range.end) {
        return { start: range.start, end: whitespaceEnd };
      }
      return range;
    });
  const withoutLinks = mergedRanges
    .sort((a, b) => b.start - a.start)
    .reduce(
      (value, range) =>
        `${value.slice(0, range.start)}${value.slice(range.end)}`,
      markdown,
    );
  return withoutLinks;
}

/**
 * 浏览器局部复制会从 DOM 读取 selection。复制片段必须克隆后再清理 citation
 * 与公式渲染节点，不能修改正在阅读的初稿 DOM，也不能移除普通外链。
 */
export function cloneCleanAidraftSelection(content: DocumentFragment): DocumentFragment {
  const copy = content.cloneNode(true) as DocumentFragment;

  // KaTeX 的 htmlAndMathml 输出同时包含 MathML、可视 HTML 和 Slate spacer。直接
  // 复制会让 Plate 的 HTML paste 把同一公式解析多次。按 KaTeX copy-tex 的做法
  // 读取唯一 TeX annotation，但以 Plate 节点属性区分行内/块级公式。
  copy
    .querySelectorAll<HTMLElement>(PLATE_VOID_ELEMENT_SELECTOR)
    .forEach((element) => {
      const annotation = element.querySelector(TEX_ANNOTATION_SELECTOR);
      if (!annotation?.textContent) return;

      const isInline = element.dataset.slateInline === 'true';
      // 块公式使用 pre 保留 $$ 分隔符的换行；普通 div 会被 Turndown 折叠成
      // "$$ expression $$"，继而被 Markdown 解析器误判为行内公式。
      const replacement = document.createElement(isInline ? 'span' : 'pre');
      replacement.textContent = isInline
        ? `$${annotation.textContent}$`
        : `$$\n${annotation.textContent}\n$$`;
      element.replaceWith(replacement);
    });

  copy.querySelectorAll(CITATION_ANCHOR_SELECTOR).forEach((anchor) => {
    const siblings = [anchor.previousSibling, anchor.nextSibling];
    anchor.remove();
    siblings.forEach((sibling) => {
      if (
        sibling instanceof HTMLSpanElement &&
        sibling.contentEditable === 'false' &&
        sibling.style.fontSize === '0px' &&
        sibling.textContent === '\u00a0'
      ) {
        sibling.remove();
      }
    });
  });

  // Plate 把正文字符包在多层 data-slate-* span 中。角标移除后，标点与其前方
  // 空格可能分属不同文本节点，因此需要按 DOM 文本顺序处理，而不能只看直接子节点。
  copy.normalize();
  const textNodes: Text[] = [];
  const collectTextNodes = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        textNodes.push(child as Text);
      } else {
        collectTextNodes(child);
      }
    });
  };
  collectTextNodes(copy);
  textNodes.forEach((node, index) => {
    node.data = node.data.replace(/[ \t\u00a0]+(?=[，。！？；：、])/g, '');
    if (!/^[，。！？；：、]/.test(node.data)) return;

    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const previous = textNodes[previousIndex];
      if (!previous.data) continue;
      previous.data = previous.data.replace(/[ \t\u00a0]+$/, '');
      break;
    }
  });
  return copy;
}

interface AidraftClipboardEvent {
  clipboardData: Pick<DataTransfer, 'setData'> | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

type FragmentNode = Descendant & Record<string, unknown>;
type AidraftFragmentProvider = (range: Range) => Descendant[] | null;

function isCitationNode(node: FragmentNode): boolean {
  return (
    node.type === 'a' &&
    typeof node.url === 'string' &&
    node.url.includes('#cit-')
  );
}

function isCitationSeparator(node: FragmentNode): boolean {
  return typeof node.text === 'string' && /^[\s,，、]*$/.test(node.text);
}

function trimLastText(nodes: FragmentNode[]): boolean {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (typeof node.text === 'string') {
      const trimmed = node.text.replace(/[ \t\u00a0]+$/, '');
      if (trimmed === node.text) continue;
      node.text = trimmed;
      if (trimmed.length === 0) nodes.splice(index, 1);
      return true;
    }
    if (Array.isArray(node.children)) {
      if (trimLastText(node.children as FragmentNode[])) return true;
    }
  }
  return false;
}

function firstNonEmptyText(node: FragmentNode): string | null {
  if (typeof node.text === 'string') return node.text || null;
  if (!Array.isArray(node.children)) return null;
  for (const child of node.children) {
    const childNode = child as FragmentNode;
    const text = firstNonEmptyText(childNode);
    if (text) return text;
  }
  return null;
}

function startsWithPunctuation(node: FragmentNode): boolean {
  const text = firstNonEmptyText(node);
  return !!text && /^[，。！？；：、]/.test(text);
}

function sanitizeFragmentChildren(children: Descendant[]): FragmentNode[] {
  const result: FragmentNode[] = [];
  let citationRemoved = false;

  children.forEach((rawChild, index) => {
    const child = rawChild as FragmentNode;
    if (isCitationNode(child)) {
      citationRemoved = true;
      return;
    }

    const next = children[index + 1] as FragmentNode | undefined;
    if (
      citationRemoved &&
      isCitationSeparator(child) &&
      next &&
      isCitationNode(next)
    ) {
      return;
    }

    const sanitizedChildren = Array.isArray(child.children)
      ? sanitizeFragmentChildren(child.children as Descendant[])
      : null;
    const sanitized = sanitizedChildren
      ? ({
          ...child,
          // Slate 元素必须至少保留一个文本叶；例如只复制一个 citation 时，
          // 清理后的段落仍需是合法片段，才能被 insertFragment 接受。
          children:
            sanitizedChildren.length > 0 ? sanitizedChildren : [{ text: '' }],
        } as FragmentNode)
      : ({ ...child } as FragmentNode);

    if (citationRemoved && startsWithPunctuation(sanitized)) {
      trimLastText(result);
    }
    result.push(sanitized);
    citationRemoved = false;
  });

  if (citationRemoved) trimLastText(result);
  return result;
}

/**
 * AI 初稿的内部复制必须保留 Plate 节点类型和属性。这里只删除 citation 链接节点，
 * 不序列化公式或其他富文本节点，避免 HTML/Markdown 往返损坏结构。
 */
export function stripAidraftCitationNodes(
  fragment: Descendant[],
): Descendant[] {
  return sanitizeFragmentChildren(fragment) as Descendant[];
}

/**
 * 写入清理后的 AI 初稿选区，并终止浏览器或编辑器的默认复制。应用内粘贴使用
 * Plate 结构化片段；HTML / 纯文本只作为粘贴到外部应用时的兼容格式。
 */
export function copyAidraftSelection(
  event: AidraftClipboardEvent,
  pane: HTMLElement | null,
  selection: Selection | null = window.getSelection(),
  getFragment?: AidraftFragmentProvider,
): boolean {
  const clipboardData = event.clipboardData;
  if (!clipboardData || !selection || selection.rangeCount === 0 || !pane) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!pane.contains(range.startContainer) || !pane.contains(range.endContainer)) {
    return false;
  }

  const selected = range.cloneContents();
  const hasCitation = selected.querySelector(CITATION_ANCHOR_SELECTOR);
  const hasEquation = selected.querySelector(
    `${PLATE_VOID_ELEMENT_SELECTOR} ${TEX_ANNOTATION_SELECTOR}`,
  );
  const fragment = getFragment?.(range);
  if (!fragment?.length && !hasCitation && !hasEquation) return false;

  const wrapper = document.createElement('div');
  wrapper.append(cloneCleanAidraftSelection(selected));
  event.preventDefault();
  event.stopPropagation();
  if (fragment?.length) {
    clipboardData.setData(
      LIMINAL_FRAGMENT_MIME,
      encodeInternalFragment(stripAidraftCitationNodes(fragment)),
    );
  }
  clipboardData.setData(
    'text/plain',
    wrapper.innerText || wrapper.textContent || '',
  );
  clipboardData.setData('text/html', wrapper.innerHTML);
  return true;
}

/**
 * 只读 Slate 的选区不会获得焦点，copy 事件通常以 BODY 为 target，无法由
 * AI 栏自身监听。使用 document 捕获监听，再由 Selection 边界限定作用范围。
 */
export function registerAidraftCopyHandler(
  getPane: () => HTMLElement | null,
  getFragment?: AidraftFragmentProvider,
  target: Document = document,
): () => void {
  const handleCopy = (event: ClipboardEvent) => {
    copyAidraftSelection(event, getPane(), window.getSelection(), getFragment);
  };
  target.addEventListener('copy', handleCopy, true);
  return () => target.removeEventListener('copy', handleCopy, true);
}

/**
 * 前端读取历史 aidraft 时统一 citation 表示：旧数字链接补上 #cit-N + title，
 * 遗留 [^N] 也按来源表恢复成同一链接。只处理「来源」小节之前的正文。
 */
export function normalizeAidraftCitationLinks(markdown: string): string {
  const sourceIdx = markdown.indexOf(SOURCE_HEADING);
  const body = sourceIdx < 0 ? markdown : markdown.slice(0, sourceIdx);
  const sourceSection = sourceIdx < 0 ? '' : markdown.slice(sourceIdx);
  const sources = new Map<string, AidraftSourceRef>();
  for (const match of sourceSection.matchAll(SOURCE_LINE_RE)) {
    sources.set(match[1], { title: match[2], url: match[3] });
  }

  const normalizedBody = body
    .replace(LEGACY_FOOTNOTE_RE, (_whole, n: string) => {
      const source = sources.get(n);
      // 无法匹配来源的历史脏数据退化为可见文本，不能交给 Plate 生成空块。
      if (!source) return `[${n}]`;
      return `[${n}](${source.url}#cit-${n} "${escapeMarkdownTitle(source.title)}")`;
    })
    .replace(
      INLINE_NUMERIC_LINK_RE,
      (whole, n: string, href: string) => {
        if (href.includes('#cit-')) return whole;
        const source = sources.get(n);
        if (!source || stripCitationFragment(href) !== source.url) return whole;
        return `[${n}](${source.url}#cit-${n} "${escapeMarkdownTitle(source.title)}")`;
      },
    );

  return `${normalizedBody}${sourceSection}`;
}
