import { afterEach, describe, expect, it } from 'vitest';

import { installCustomHighlightStyles } from '../custom-highlight-styles';

const STYLE_ID = 'liminal-custom-highlight-styles';

describe('installCustomHighlightStyles', () => {
  afterEach(() => {
    document.getElementById(STYLE_ID)?.remove();
  });

  it('installs the chat selection highlight style when the API is supported', () => {
    const cssWithHighlights = { highlights: new Map() } as unknown as typeof CSS;

    expect(installCustomHighlightStyles(document, cssWithHighlights)).toBe(true);

    const style = document.getElementById(STYLE_ID);
    expect(style?.textContent).toContain('::highlight(chat-selection)');
  });

  it('does not install duplicate styles', () => {
    const cssWithHighlights = { highlights: new Map() } as unknown as typeof CSS;

    installCustomHighlightStyles(document, cssWithHighlights);
    installCustomHighlightStyles(document, cssWithHighlights);

    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
  });

  it('does nothing when the Custom Highlight API is unavailable', () => {
    const cssWithoutHighlights = {} as typeof CSS;

    expect(installCustomHighlightStyles(document, cssWithoutHighlights)).toBe(false);
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });
});
