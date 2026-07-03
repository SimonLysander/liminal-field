export type CopyPageMetadata = {
  key?: string;
  label: string;
  value: string | number | null | undefined;
};

export type CopyPageReference = {
  index?: number | string;
  title: string;
  url?: string | null;
  sourceName?: string | null;
};

export type CopyPageMarkdownInput = {
  title: string;
  source?: string;
  summary?: string | null;
  bodyMarkdown?: string | null;
  metadata?: CopyPageMetadata[];
  references?: CopyPageReference[];
};

function compactBlankLines(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatYamlValue(value: string | number): string {
  if (typeof value === 'number') return String(value);
  if (value.includes('\n')) {
    return `|-\n${value
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}`;
  }
  return JSON.stringify(value);
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
}

function escapeMarkdownUrl(value: string): string {
  return value.replace(/\)/g, '%29').replace(/\s/g, '%20');
}

function buildFrontMatter(input: CopyPageMarkdownInput): string {
  const lines: string[] = [];
  const title = input.title.trim();

  if (title) lines.push(`title: ${formatYamlValue(title)}`);
  if (input.source?.trim()) {
    lines.push(`source: ${formatYamlValue(input.source.trim())}`);
  }

  for (const item of input.metadata ?? []) {
    if (item.value === null || item.value === undefined || !`${item.value}`.trim()) continue;
    lines.push(`${item.key ?? item.label}: ${formatYamlValue(item.value)}`);
  }

  if (input.summary?.trim()) {
    lines.push(`summary: ${formatYamlValue(input.summary.trim())}`);
  }

  return lines.length > 0 ? `---\n${lines.join('\n')}\n---` : '';
}

export function buildCopyPageMarkdown(input: CopyPageMarkdownInput): string {
  const frontMatter = buildFrontMatter(input);
  const body = compactBlankLines(input.bodyMarkdown?.trim() ?? '');
  const sections: string[] = [];

  if (frontMatter) sections.push(frontMatter);
  if (body) sections.push(body);

  const referenceLines =
    input.references
      ?.filter((ref) => ref.title.trim() || ref.url?.trim())
      .map((ref, idx) => {
        const label = ref.index ?? idx + 1;
        const source = ref.sourceName ? ` — ${ref.sourceName}` : '';
        const title = escapeMarkdownLinkText(`${ref.title}${source}`);
        return ref.url
          ? `- [${label}] [${title}](${escapeMarkdownUrl(ref.url)})`
          : `- [${label}] ${title}`;
      }) ?? [];
  if (referenceLines.length > 0) {
    sections.push(['## 引用', ...referenceLines].join('\n'));
  }

  return compactBlankLines(sections.join('\n\n'));
}
