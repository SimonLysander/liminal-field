interface AidraftSourceRef {
  title: string;
  url: string;
}

const SOURCE_HEADING = '\n## 来源\n';
const SOURCE_LINE_RE = /^(\d+)\.\s+\[([^\]]+)\]\(([^)]+)\)\s*$/gm;
const INLINE_NUMERIC_LINK_RE = /\[(\d+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

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
