import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

const sheet = new CSSStyleSheet();
sheet.replaceSync(readFileSync('src/index.css', 'utf8'));
const inputBackgroundSelectors = Array.from(sheet.cssRules)
  .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
  .filter(
    (rule) =>
      rule.selectorText.startsWith('input') && rule.style.background === 'var(--hover-overlay)',
  )
  .map((rule) => rule.selectorText);

describe('shared input focus styling', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('continues to highlight focused standalone inputs', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    expect(inputBackgroundSelectors.some((selector) => input.matches(selector))).toBe(true);
  });

  it('does not add a rectangular focus background inside a command panel', () => {
    const input = document.createElement('input');
    input.setAttribute('cmdk-input', '');
    document.body.append(input);
    input.focus();

    expect(inputBackgroundSelectors).not.toHaveLength(0);
    expect(inputBackgroundSelectors.some((selector) => input.matches(selector))).toBe(false);
  });
});
