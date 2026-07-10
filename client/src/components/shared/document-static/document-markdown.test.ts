// @vitest-environment node

import { BaseH1Plugin as H1Plugin } from '@platejs/basic-nodes';
import {
  BaseCodeBlockPlugin as CodeBlockPlugin,
  BaseCodeLinePlugin as CodeLinePlugin,
} from '@platejs/code-block';
import { BaseLinkPlugin as LinkPlugin } from '@platejs/link';
import { BaseListPlugin as ListPlugin } from '@platejs/list';
import { MarkdownPlugin } from '@platejs/markdown';
import {
  BaseTableCellHeaderPlugin as TableCellHeaderPlugin,
  BaseTableCellPlugin as TableCellPlugin,
  BaseTablePlugin as TablePlugin,
  BaseTableRowPlugin as TableRowPlugin,
} from '@platejs/table';
import {
  BaseParagraphPlugin as ParagraphPlugin,
  createSlateEditor,
  type SlateEditor,
  type TElement,
} from 'platejs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: loggerError,
  })),
}));

import {
  deserializeDocumentMarkdown,
  normalizeDocumentNodes,
  preprocessDocumentMarkdown,
} from './document-markdown';

const MARKDOWN_FIXTURE = [
  '# Parsing contract',
  '',
  'Published <date value="2026-07-10" /> with [source](https://example.com).',
  '',
  '- Parent item',
  '  - Nested item',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| Alpha | Beta |',
  '',
  'Inline math $a^2 + b^2 = c^2$.',
  '',
  '$$',
  '\\int_0^1 x^2 dx',
  '$$',
  '',
  '```ts',
  'const first = 1;',
  'const second = 2;',
  '```',
].join('\n');

function createMarkdownEditor(): SlateEditor {
  return createSlateEditor({
    plugins: [
      ParagraphPlugin,
      H1Plugin,
      CodeBlockPlugin,
      CodeLinePlugin,
      LinkPlugin,
      ListPlugin,
      TablePlugin,
      TableRowPlugin,
      TableCellPlugin,
      TableCellHeaderPlugin,
      MarkdownPlugin.configure({
        options: { remarkPlugins: [remarkGfm, remarkMath] },
      }),
    ],
  });
}

function visitNodes(nodes: unknown[], visit: (node: Record<string, unknown>) => void): void {
  for (const value of nodes) {
    if (typeof value !== 'object' || value === null) continue;
    const node = value as Record<string, unknown>;
    visit(node);
    if (Array.isArray(node.children)) visitNodes(node.children, visit);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  loggerError.mockReset();
});

describe('document Markdown parsing contract', () => {
  it('preprocesses date tags without changing surrounding Markdown', () => {
    const preprocessed = preprocessDocumentMarkdown(
      'Before <date value="2026-07-10" /> after',
    );

    expect(preprocessed).not.toContain('<date');
    expect(preprocessed).not.toContain('%%DATE:');
    expect(preprocessed).toMatch(/^Before .+ after$/);
  });

  it('restores date placeholders and keeps each code line separate', () => {
    const dateMarker = preprocessDocumentMarkdown('<date value="2026-07-10" />');
    const nodes = normalizeDocumentNodes([
      {
        type: 'p',
        children: [{ text: `Before ${dateMarker} after` }],
      },
      {
        type: 'code_block',
        children: [{ type: 'code_line', children: [{ text: 'first\nsecond' }] }],
      },
    ] as TElement[]);

    expect(nodes[0]).toEqual({
      type: 'p',
      children: [
        { text: 'Before ' },
        { type: 'date', date: '2026-07-10', children: [{ text: '' }] },
        { text: ' after' },
      ],
    });
    expect(nodes[1].children).toEqual([
      { type: 'code_line', children: [{ text: 'first' }] },
      { type: 'code_line', children: [{ text: 'second' }] },
    ]);
  });

  it('preserves literal date placeholder text while restoring real date tags', () => {
    const literalPlaceholder = '%%DATE:2025-01-01%%';
    const nodes = deserializeDocumentMarkdown(
      createMarkdownEditor(),
      `Literal ${literalPlaceholder} and <date value="2026-07-10" />.`,
    );
    const dates: string[] = [];
    const texts: string[] = [];

    visitNodes(nodes, (node) => {
      if (node.type === 'date' && typeof node.date === 'string') dates.push(node.date);
      if (typeof node.text === 'string') texts.push(node.text);
    });

    expect(dates).toEqual(['2026-07-10']);
    expect(texts.join('')).toContain(literalPlaceholder);
  });

  it('parses the full document fixture without dropping supported content', () => {
    const nodes = deserializeDocumentMarkdown(createMarkdownEditor(), MARKDOWN_FIXTURE);
    const types: string[] = [];
    const texts: string[] = [];
    const dates: string[] = [];
    const links: Array<{ url: string }> = [];
    const equations: Array<{ type: string; texExpression: string }> = [];

    visitNodes(nodes, (node) => {
      if (typeof node.type === 'string') types.push(node.type);
      if (typeof node.text === 'string' && node.text !== '') texts.push(node.text);
      if (node.type === 'date' && typeof node.date === 'string') dates.push(node.date);
      if (node.type === 'a' && typeof node.url === 'string') links.push({ url: node.url });
      if (
        (node.type === 'inline_equation' || node.type === 'equation') &&
        typeof node.texExpression === 'string'
      ) {
        equations.push({ type: node.type, texExpression: node.texExpression });
      }
    });

    expect(types).toEqual(
      expect.arrayContaining([
        'h1',
        'date',
        'a',
        'table',
        'inline_equation',
        'equation',
        'code_block',
      ]),
    );
    expect(texts).toEqual([
      'Parsing contract',
      'Published ',
      ' with ',
      'source',
      '.',
      'Parent item',
      'Nested item',
      'Name',
      'Value',
      'Alpha',
      'Beta',
      'Inline math ',
      '.',
      'const first = 1;',
      'const second = 2;',
    ]);
    expect(dates).toEqual(['2026-07-10']);
    expect(links).toEqual([{ url: 'https://example.com' }]);
    expect(equations).toEqual([
      { type: 'inline_equation', texExpression: 'a^2 + b^2 = c^2' },
      { type: 'equation', texExpression: '\\int_0^1 x^2 dx' },
    ]);

    const codeBlock = nodes.find((node) => node.type === 'code_block');
    expect(codeBlock?.children).toEqual([
      { type: 'code_line', children: [{ text: 'const first = 1;' }] },
      { type: 'code_line', children: [{ text: 'const second = 2;' }] },
    ]);
  });

  it('returns an empty value for empty Markdown', () => {
    expect(deserializeDocumentMarkdown(createMarkdownEditor(), '')).toEqual([]);
  });

  it('falls back to the original text without logging an error that contains the body', () => {
    const markdown = 'private Markdown body';
    const parserError = new Error(markdown);
    const editor = {
      getOptions: vi.fn(() => {
        throw parserError;
      }),
    } as unknown as SlateEditor;
    expect(deserializeDocumentMarkdown(editor, markdown)).toEqual([
      { type: 'p', children: [{ text: markdown }] },
    ]);
    expect(loggerError).toHaveBeenCalledWith('markdown_parse_failed', {
      errorType: 'Error',
      markdownLength: markdown.length,
    });
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(markdown);
  });
});
