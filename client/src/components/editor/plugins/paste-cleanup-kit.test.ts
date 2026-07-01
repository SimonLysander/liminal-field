import { describe, expect, it } from 'vitest';
import {
  decodeInternalFragment,
  encodeInternalFragment,
  hasSlateInternalFragment,
  isCodePasteSource,
} from './paste-cleanup-kit';

describe('isCodePasteSource', () => {
  it('does not treat ordinary pre-wrap rich text as code', () => {
    const html =
      '<div style="white-space: pre-wrap; font-family: var(--font-serif);">普通段落\n第二行</div>';

    expect(isCodePasteSource(html)).toBe(false);
  });

  it('does not treat plain monospace-styled text as code by itself', () => {
    const html = '<span style="font-family: ui-monospace, SFMono-Regular;">plaintext</span>';

    expect(isCodePasteSource(html)).toBe(false);
  });

  it('treats explicit pre code markup as code', () => {
    const html = '<pre><code class="language-ts">const x = 1;</code></pre>';

    expect(isCodePasteSource(html)).toBe(true);
  });

  it('treats editor/highlighter markup as code', () => {
    const html = '<div class="monaco-editor"><span>const x = 1;</span></div>';

    expect(isCodePasteSource(html)).toBe(true);
  });
});

describe('internal fragments', () => {
  it('detects Slate clipboard MIME', () => {
    expect(hasSlateInternalFragment(['text/html', 'application/x-slate-fragment'], '')).toBe(true);
  });

  it('detects Slate HTML fallback marker', () => {
    const html = '<span data-slate-fragment="abc">hello</span>';

    expect(hasSlateInternalFragment(['text/html'], html)).toBe(true);
  });

  it('round-trips liminal fragment JSON', () => {
    const fragment = [{ type: 'p', children: [{ text: 'hello', bold: true }] }];

    expect(decodeInternalFragment(encodeInternalFragment(fragment))).toEqual(fragment);
  });

  it('rejects invalid liminal fragment JSON', () => {
    expect(decodeInternalFragment('{"type":"p"}')).toBeNull();
    expect(decodeInternalFragment('not json')).toBeNull();
  });
});
