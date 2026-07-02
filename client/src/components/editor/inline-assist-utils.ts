import { getSuggestionKey, type TResolvedSuggestion, type TSuggestionDescription } from '@platejs/suggestion';
import { KEYS, type Descendant } from 'platejs';

import type { InlineAssistAction } from '@/components/editor/inline-assist-events';

export function readNodeText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  if ('text' in node && typeof node.text === 'string') return node.text;
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map(readNodeText).join('');
  }
  return '';
}

export function hasInlineAssistPreview(children: Descendant[]): boolean {
  const visit = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    if ((node as { aiPreview?: unknown }).aiPreview === true) return true;
    if ((node as { ai?: unknown }).ai === true) return true;
    if ('children' in node && Array.isArray(node.children)) {
      return node.children.some(visit);
    }
    return false;
  };

  return children.some(visit);
}

export function hasTransientEditorNode(children: Descendant[]): boolean {
  const visit = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;

    const type = (node as { type?: unknown }).type;
    if (
      type === KEYS.slashInput ||
      type === 'slash_input' ||
      type === 'placeholder' ||
      type === 'proposal-old' ||
      type === 'proposal-new'
    ) {
      return true;
    }

    if ((node as { aiPreview?: unknown }).aiPreview === true) return true;
    if ((node as { ai?: unknown }).ai === true) return true;

    if ('children' in node && Array.isArray(node.children)) {
      return node.children.some(visit);
    }

    return false;
  };

  return children.some(visit);
}

export function getInlineAssistInstruction(action: InlineAssistAction): string {
  switch (action) {
    case 'make-shorter':
      return '压缩选中内容或当前段落,保留关键信息,表达更简洁。';
    case 'revise':
      return '修订选中内容或光标附近内容,修正问题并让表达更准确自然。';
    case 'custom':
    case 'continue':
    default:
      return '从光标处自然续写一小段。';
  }
}

export function toResolvedSuggestionDescription(
  description: TSuggestionDescription,
): TResolvedSuggestion {
  const insertedText =
    'insertedText' in description ? description.insertedText : undefined;
  const deletedText =
    'deletedText' in description ? description.deletedText : undefined;
  const type =
    description.type === 'insertion'
      ? 'insert'
      : description.type === 'deletion'
        ? 'remove'
        : 'replace';

  return {
    createdAt: new Date(),
    keyId: getSuggestionKey(description.suggestionId),
    newText: insertedText,
    suggestionId: description.suggestionId,
    text: deletedText,
    type,
    userId: description.userId,
  };
}
