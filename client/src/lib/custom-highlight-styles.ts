const CUSTOM_HIGHLIGHT_STYLE_ID = 'liminal-custom-highlight-styles';

const CUSTOM_HIGHLIGHT_STYLES = `
::highlight(chat-selection) {
  background-color: color-mix(in srgb, var(--accent) 28%, transparent);
  color: var(--ink);
}
`;

/**
 * Lightning CSS does not parse the Custom Highlight pseudo-element yet.
 * Install the rule at runtime only in browsers that expose the matching API.
 */
export function installCustomHighlightStyles(
  doc: Document = document,
  cssRef: typeof CSS | undefined = globalThis.CSS,
): boolean {
  if (!cssRef || !('highlights' in cssRef)) return false;
  if (doc.getElementById(CUSTOM_HIGHLIGHT_STYLE_ID)) return true;

  const style = doc.createElement('style');
  style.id = CUSTOM_HIGHLIGHT_STYLE_ID;
  style.textContent = CUSTOM_HIGHLIGHT_STYLES;
  doc.head.append(style);
  return true;
}
