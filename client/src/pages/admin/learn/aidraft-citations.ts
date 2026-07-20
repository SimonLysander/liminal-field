interface AidraftSourceRef {
  title: string;
  url: string;
}

const SOURCE_HEADING = '\n## 来源\n';
const SOURCE_LINE_RE = /^(\d+)\.\s+\[([^\]]+)\]\(([^)]+)\)\s*$/gm;
const INLINE_NUMERIC_LINK_RE = /\[(\d+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const INLINE_CITATION_LINK_RE = /\[\d+\]\([^)]*#cit-\d+(?:\s+"[^"]*")?\)/g;
const RAW_CITATION_MARKER_RE = /\[@#CIT\s+\d+\]/gi;

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
  return markdown
    .replace(INLINE_CITATION_LINK_RE, '')
    .replace(RAW_CITATION_MARKER_RE, '');
}

/**
 * 浏览器局部复制会从 DOM 读取 selection。复制片段必须克隆后再删角标，
 * 不能修改正在阅读的初稿 DOM，也不能移除普通外链。
 */
export function cloneWithoutCitationAnchors(content: DocumentFragment): DocumentFragment {
  const copy = content.cloneNode(true) as DocumentFragment;
  copy.querySelectorAll('a[href*="#cit-"]').forEach((anchor) => anchor.remove());
  return copy;
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
