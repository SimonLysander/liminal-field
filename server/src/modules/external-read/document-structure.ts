import MarkdownIt from 'markdown-it';
import { Parser } from 'htmlparser2';

const parser = new MarkdownIt({ html: true });
export interface DocumentSection {
  title: string;
  level: number;
  start: number;
  end: number;
}

/** Token line maps preserve original Markdown, including math, tables and code. */
export function documentStructure(markdown: string) {
  const lines = markdown.split('\n');
  const offsets = [0];
  for (const line of lines)
    offsets.push(offsets[offsets.length - 1] + line.length + 1);
  const tokens = parser.parse(markdown, {});
  const sections: DocumentSection[] = [];
  const boundaries = new Set([markdown.length]);
  const assets: Array<{ fileName: string; description: string }> = [];
  const addAsset = (path: string | null, description: string) => {
    if (!path?.startsWith('./assets/')) return;
    let fileName: string;
    try {
      fileName = decodeURIComponent(path.slice('./assets/'.length));
    } catch {
      return;
    }
    if (isAssetName(fileName)) assets.push({ fileName, description });
  };
  const addHtmlAssets = (html: string) => {
    // Parse attributes without a DOM, scripts or network. Fences are not HTML tokens.
    new Parser({
      onopentag(name, attributes) {
        addAsset(
          attributes.src ?? (name === 'a' ? attributes.href : null),
          attributes.alt ?? attributes.title ?? '',
        );
        if (name === 'video')
          addAsset(attributes.poster, attributes.title ?? '');
      },
    }).end(html);
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.level === 0 && token.map) {
      boundaries.add(Math.min(offsets[token.map[1]], markdown.length));
      if (token.type === 'heading_open') {
        const title = tokens[i + 1]?.content ?? '';
        sections.push({
          title,
          level: Number(token.tag.slice(1)),
          start: offsets[token.map[0]],
          end: markdown.length,
        });
      }
    }
    for (const child of token.children ?? []) {
      const path =
        child.type === 'image'
          ? child.attrGet('src')
          : child.type === 'link_open'
            ? child.attrGet('href')
            : null;
      addAsset(
        path,
        child.type === 'image' ? child.content : (tokens[i]?.content ?? ''),
      );
      if (child.type === 'html_inline') addHtmlAssets(child.content);
    }
    if (token.type === 'html_block') addHtmlAssets(token.content);
  }
  const stack: DocumentSection[] = [];
  for (const section of sections) {
    while (stack.length && stack[stack.length - 1].level >= section.level)
      stack.pop()!.end = section.start;
    stack.push(section);
  }
  if (sections[0]?.start > 0 && markdown.slice(0, sections[0].start).trim())
    sections.unshift({ title: '', level: 0, start: 0, end: sections[0].start });
  return {
    sections,
    boundaries: [...boundaries].sort((a, b) => a - b),
    assets,
  };
}

export type DocumentStructure = ReturnType<typeof documentStructure>;

export function isAssetName(fileName: string): boolean {
  return (
    !!fileName &&
    fileName.length <= 255 &&
    !fileName.includes('\\') &&
    !fileName.includes('/') &&
    ![...fileName].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    fileName !== '.' &&
    fileName !== '..'
  );
}

export function markdownPage(
  markdown: string,
  offset: number,
  maxCharacters: number,
  boundaries: readonly number[],
) {
  const cutoff = Math.min(offset + maxCharacters, markdown.length);
  const boundary = boundaries
    .filter((end) => end > offset && end <= cutoff)
    .at(-1);
  let end = boundary ?? cutoff;
  // Do not split a surrogate pair when a very long block requires a partial page.
  if (end < markdown.length && /[\uD800-\uDBFF]/.test(markdown[end - 1])) end--;
  return {
    markdown: markdown.slice(offset, end),
    end,
    partialBlock:
      !boundaries.includes(end) || (offset > 0 && !boundaries.includes(offset)),
  };
}
