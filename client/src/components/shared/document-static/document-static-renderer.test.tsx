import { fireEvent, render, screen } from '@testing-library/react';
import { createStaticEditor, PlateStatic } from 'platejs/static';
import type { Value } from 'platejs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platejs/math', async () => {
  const [{ createSlatePlugin }, katex] = await Promise.all([import('platejs'), import('katex')]);

  return {
    BaseEquationPlugin: createSlatePlugin({ key: 'equation', node: { isElement: true } }),
    BaseInlineEquationPlugin: createSlatePlugin({ key: 'inline_equation', node: { isElement: true } }),
    getEquationHtml: ({ element, options }: { element: { texExpression?: string }; options?: object }) =>
      katex.renderToString(element.texExpression ?? '', options),
  };
});

vi.mock('@/components/shared/ImageLightbox', () => ({
  ImageLightbox: ({ initialIndex, open, urls }: {
    initialIndex: number;
    open: boolean;
    urls: string[];
  }) =>
    open ? (
      <div data-lightbox-index={initialIndex} data-lightbox-urls={urls.join(',')} role="dialog">
        preview
      </div>
    ) : null,
}));

import { StaticDocumentKit } from './document-static-kit';
import { deserializeDocumentMarkdown } from './document-markdown';

const writeText = vi.fn().mockResolvedValue(undefined);

const STATIC_VALUE = [
  { type: 'p', children: [{ text: 'paragraph' }] },
  ...(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((type) => ({
    type,
    children: [{ text: `${type} text` }],
  })),
  { type: 'blockquote', children: [{ text: 'quoted' }] },
  { type: 'hr', children: [{ text: '' }] },
  {
    type: 'p',
    children: [
      {
        text: 'marks',
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        code: true,
        highlight: true,
        kbd: true,
        subscript: true,
        superscript: true,
        color: '#112233',
        backgroundColor: '#ddeeff',
        fontSize: '18px',
        fontFamily: 'serif',
      },
      { text: ' ' },
      { type: 'a', url: 'https://example.com/source', children: [{ text: 'source' }] },
      { text: ' ' },
      { type: 'date', date: '2026-07-10', children: [{ text: '' }] },
      { text: ' ' },
      { type: 'inline_equation', texExpression: 'x^2', children: [{ text: '' }] },
    ],
  },
  {
    type: 'static_list',
    listStyleType: 'disc',
    children: [{ type: 'static_list_item', children: [{ text: 'unordered item' }] }],
  },
  {
    type: 'static_list',
    listStyleType: 'decimal',
    listStart: 3,
    children: [{ type: 'static_list_item', children: [{ text: 'ordered item' }] }],
  },
  {
    type: 'static_list',
    listStyleType: 'todo',
    children: [{ type: 'static_list_item', checked: true, children: [{ text: 'task item' }] }],
  },
  {
    type: 'table',
    colSizes: [160, 240],
    children: [
      {
        type: 'tr',
        children: [
          { type: 'th', background: '#eeeeee', children: [{ type: 'p', children: [{ text: 'header' }] }] },
          { type: 'th', children: [{ type: 'p', children: [{ text: 'header two' }] }] },
        ],
      },
      {
        type: 'tr',
        children: [
          { type: 'td', background: '#ffffff', children: [{ type: 'p', children: [{ text: 'cell' }] }] },
          { type: 'td', children: [{ type: 'p', children: [{ text: 'cell two' }] }] },
        ],
      },
    ],
  },
  {
    type: 'code_block',
    lang: 'typescript',
    children: [{ type: 'code_line', children: [{ text: 'const answer = 42;' }] }],
  },
  { type: 'equation', texExpression: 'a^2+b^2=c^2', children: [{ text: '' }] },
  {
    type: 'img',
    url: '/assets/first.jpg',
    alt: 'first image',
    caption: [{ text: 'first caption' }],
    children: [{ text: '' }],
  },
  {
    type: 'img',
    url: '/assets/first.jpg',
    alt: 'second image',
    caption: [{ text: 'second caption' }],
    children: [{ text: '' }],
  },
  {
    type: 'file',
    url: '/assets/notes.pdf',
    name: 'notes.pdf',
    caption: [{ text: 'file caption' }],
    children: [{ text: '' }],
  },
  { type: 'unknown_block', children: [{ text: 'fallback text' }] },
] as unknown as Value;

function renderStaticDocument(value = STATIC_VALUE) {
  const editor = createStaticEditor({ plugins: StaticDocumentKit, value });

  return render(<PlateStatic editor={editor} />);
}

const CONTIGUOUS_LIST_VALUE = [
  {
    type: 'static_list',
    listStyleType: 'disc',
    children: [
      { type: 'static_list_item', children: [{ text: 'first bullet' }] },
      { type: 'static_list_item', children: [{ text: 'second bullet' }] },
    ],
  },
  {
    type: 'static_list',
    listStyleType: 'decimal',
    children: [
      { type: 'static_list_item', children: [{ text: 'first ordered' }] },
      { type: 'static_list_item', children: [{ text: 'second ordered' }] },
    ],
  },
] as unknown as Value;

afterEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  writeText.mockClear();
});

describe('StaticDocumentKit', () => {
  it('deserializes Markdown lists through the static kit into nested semantic lists', () => {
    const parser = createStaticEditor({ plugins: StaticDocumentKit });
    const value = deserializeDocumentMarkdown(
      parser,
      ['- Parent item', '  - Nested item', '- Second parent item'].join('\n'),
    );
    const editor = createStaticEditor({ plugins: StaticDocumentKit, value });
    const { container } = render(<PlateStatic editor={editor} />);

    expect(container.querySelectorAll('ul')).toHaveLength(2);
    expect(container.querySelectorAll('ul > li')).toHaveLength(3);
    expect(container.querySelector('ul > li > ul > li')).toHaveTextContent('Nested item');
  });

  it('renders each contiguous list run in one semantic list container', () => {
    const { container } = renderStaticDocument(CONTIGUOUS_LIST_VALUE);

    expect(container.querySelectorAll('ul')).toHaveLength(1);
    expect(container.querySelectorAll('ol')).toHaveLength(1);
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelector('ul ul, ul ol, ol ul, ol ol')).toBeNull();
  });

  it('renders every parser node with static semantics and preserves unknown-node content', () => {
    renderStaticDocument();

    expect(screen.getByText('paragraph').closest('div')).toHaveClass('m-0');
    for (const type of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
      expect(screen.getByText(`${type} text`).closest(type)).not.toBeNull();
    }
    expect(screen.getByText('quoted').closest('blockquote')).not.toBeNull();
    expect(document.querySelector('hr')).not.toBeNull();
    for (const tag of ['strong', 'em', 'u', 's', 'code', 'mark', 'kbd', 'sub', 'sup']) {
      expect(screen.getByText('marks').closest(tag)).not.toBeNull();
    }
    expect(screen.getByText('marks').parentElement).toHaveStyle({
      backgroundColor: '#ddeeff',
      color: '#112233',
      fontFamily: 'serif',
      fontSize: '18px',
    });
    expect(screen.getByRole('link', { name: 'source' })).toHaveAttribute(
      'href',
      'https://example.com/source',
    );
    expect(document.querySelector('[data-date-value="2026-07-10"]')).not.toBeNull();
    expect(screen.getByText('unordered item').closest('ul')).not.toBeNull();
    expect(screen.getByText('ordered item').closest('ol')).toHaveAttribute('start', '3');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('header').closest('th')).toHaveStyle({ backgroundColor: '#eeeeee' });
    expect(screen.getByText('cell').closest('td')).toHaveStyle({ backgroundColor: '#ffffff' });
    expect(document.querySelector('table')).not.toBeNull();
    expect(document.querySelector('.katex')).not.toBeNull();
    expect(document.querySelector('.katex-display')?.parentElement?.parentElement).toHaveClass(
      'overflow-x-auto',
    );
    expect(document.querySelector('.hljs-keyword')).not.toBeNull();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'first image' })).toHaveAttribute('src', '/assets/first.jpg');
    expect(screen.getByRole('link', { name: /notes\.pdf/ })).toHaveAttribute('href', '/assets/notes.pdf');
    expect(screen.getByText('first caption')).toBeInTheDocument();
    expect(screen.getByText('file caption')).toBeInTheDocument();
    expect(screen.getByText('fallback text')).toBeInTheDocument();
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it('copies the complete static code block and opens the clicked image at its document index', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    renderStaticDocument();

    fireEvent.click(screen.getByRole('button', { name: '复制全部代码' }));
    expect(writeText).toHaveBeenCalledWith('const answer = 42;');

    fireEvent.click(screen.getByRole('button', { name: '预览 second image' }));
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-lightbox-index', '1');
    expect(screen.getByRole('dialog')).toHaveAttribute(
      'data-lightbox-urls',
      '/assets/first.jpg,/assets/first.jpg',
    );
  });
});
