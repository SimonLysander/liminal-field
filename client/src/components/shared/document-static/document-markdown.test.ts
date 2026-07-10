// @vitest-environment node

import { MarkdownPlugin } from '@platejs/markdown';
import { createSlateEditor, type SlateEditor, type TElement } from 'platejs';
import { H1Plugin } from '@platejs/basic-nodes/react';
import { CodeBlockPlugin, CodeLinePlugin } from '@platejs/code-block/react';
import { LinkPlugin } from '@platejs/link/react';
import { ListPlugin } from '@platejs/list/react';
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from '@platejs/table/react';
import { ParagraphPlugin } from 'platejs/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

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
});

describe('document Markdown parsing contract', () => {
  it('preprocesses date tags without changing surrounding Markdown', () => {
    expect(preprocessDocumentMarkdown('Before <date value="2026-07-10" /> after')).toBe(
      'Before %%DATE:2026-07-10%% after',
    );
  });

  it('restores date placeholders and keeps each code line separate', () => {
    const nodes = normalizeDocumentNodes([
      {
        type: 'p',
        children: [{ text: 'Before %%DATE:2026-07-10%% after' }],
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

  it('parses the full document fixture without dropping supported content', () => {
    const nodes = deserializeDocumentMarkdown(createMarkdownEditor(), MARKDOWN_FIXTURE);
    const types: string[] = [];
    const textAndExpressions: string[] = [];

    visitNodes(nodes, (node) => {
      if (typeof node.type === 'string') types.push(node.type);
      if (typeof node.text === 'string') textAndExpressions.push(node.text);
      if (typeof node.texExpression === 'string') textAndExpressions.push(node.texExpression);
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
    expect(JSON.stringify(nodes)).toContain('Nested item');
    expect(textAndExpressions.join('\n')).toContain('Parsing contract');
    expect(textAndExpressions.join('\n')).toContain('Published ');
    expect(textAndExpressions.join('\n')).toContain('source');
    expect(textAndExpressions.join('\n')).toContain('Alpha');
    expect(textAndExpressions.join('\n')).toContain('Beta');
    expect(textAndExpressions.join('\n')).toContain('a^2 + b^2 = c^2');
    expect(textAndExpressions.join('\n')).toContain('\\int_0^1 x^2 dx');

    const codeBlock = nodes.find((node) => node.type === 'code_block');
    expect(codeBlock?.children).toEqual([
      { type: 'code_line', children: [{ text: 'const first = 1;' }] },
      { type: 'code_line', children: [{ text: 'const second = 2;' }] },
    ]);
  });

  it('returns an empty value for empty Markdown', () => {
    expect(deserializeDocumentMarkdown(createMarkdownEditor(), '')).toEqual([]);
  });

  it('falls back to the original text and records only the parser error', () => {
    const markdown = 'private Markdown body';
    const parserError = new Error('parser unavailable');
    const editor = {
      getOptions: vi.fn(() => {
        throw parserError;
      }),
    } as unknown as SlateEditor;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(deserializeDocumentMarkdown(editor, markdown)).toEqual([
      { type: 'p', children: [{ text: markdown }] },
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toContain(parserError);
    expect(errorSpy.mock.calls.flat()).not.toContain(markdown);
  });
});
