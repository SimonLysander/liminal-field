import type { Nodes } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

interface AidraftSourceRef {
  title: string;
  url: string;
}

const SOURCE_HEADING = '\n## 来源\n';
const SOURCE_LINE_RE = /^(\d+)\.\s+\[([^\]]+)\]\(([^)]+)\)\s*$/gm;
const INLINE_NUMERIC_LINK_RE = /\[(\d+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const RAW_CITATION_MARKER_RE =
  /\[@#CIT\s+\d+(?:\s*(?:,\s*\d+|-\s*\d+))*\]/gi;
const CITATION_ANCHOR_SELECTOR = 'a[href*="#cit-"]';
const PLATE_VOID_ELEMENT_SELECTOR =
  '[data-slate-node="element"][data-slate-void="true"]';
const TEX_ANNOTATION_SELECTOR = 'annotation[encoding="application/x-tex"]';
const markdownParser = unified().use(remarkParse);

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
  const ranges: Array<{ start: number; end: number }> = [];
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
  const mergedRanges = ranges
    .sort((a, b) => a.start - b.start)
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged.at(-1);
      if (
        previous &&
        /^[ \t]*[,，、][ \t]*$/.test(
          markdown.slice(previous.end, range.start),
        )
      ) {
        previous.end = range.end;
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);
  const withoutLinks = mergedRanges
    .sort((a, b) => b.start - a.start)
    .reduce(
      (value, range) =>
        `${value.slice(0, range.start)}${value.slice(range.end)}`,
      markdown,
    );
  return withoutLinks.replace(RAW_CITATION_MARKER_RE, '');
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

/**
 * 写入清理后的 AI 初稿选区，并终止浏览器或编辑器的默认复制。
 */
export function copyAidraftSelection(
  event: AidraftClipboardEvent,
  pane: HTMLElement | null,
  selection: Selection | null = window.getSelection(),
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
  if (!hasCitation && !hasEquation) return false;

  const wrapper = document.createElement('div');
  wrapper.append(cloneCleanAidraftSelection(selected));
  event.preventDefault();
  event.stopPropagation();
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
  target: Document = document,
): () => void {
  const handleCopy = (event: ClipboardEvent) => {
    copyAidraftSelection(event, getPane());
  };
  target.addEventListener('copy', handleCopy, true);
  return () => target.removeEventListener('copy', handleCopy, true);
}

/**
 * 旧 aidraft 已把 [@#CIT N] 合成为普通 [N](url)。前端读取时补上 #cit-N + title,
 * 让历史 AI 初稿也能命中 citation 角标样式；只处理「来源」小节之前的正文。
 */
export function normalizeAidraftCitationLinks(markdown: string): string {
  const sourceIdx = markdown.indexOf(SOURCE_HEADING);
  if (sourceIdx < 0) return markdown;

  const body = markdown.slice(0, sourceIdx);
  const sourceSection = markdown.slice(sourceIdx);
  const sources = new Map<string, AidraftSourceRef>();
  for (const match of sourceSection.matchAll(SOURCE_LINE_RE)) {
    sources.set(match[1], { title: match[2], url: match[3] });
  }
  if (sources.size === 0) return markdown;

  const normalizedBody = body.replace(
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
