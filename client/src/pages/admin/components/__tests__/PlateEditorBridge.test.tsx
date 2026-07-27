import { render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DraftAssetProvider } from '@/contexts/DraftAssetContext';

vi.mock('@/components/editor/editor-kit', async () => {
  const { AIChatPlugin, AIPlugin } = await import('@platejs/ai/react');
  return { EditorKit: [AIPlugin, AIChatPlugin] };
});

import {
  PlateMarkdownEditor,
  type EditorBridgeHandle,
} from '../PlateEditor';

describe('PlateMarkdownEditor editor bridge', () => {
  it('maps a read-only DOM selection back to the original Plate fragment', async () => {
    const bridgeRef = createRef<EditorBridgeHandle>();
    const { container } = render(
      <DraftAssetProvider contentItemId="ci-test">
        <PlateMarkdownEditor
          editorRefSync={bridgeRef}
          initialMarkdown="将止损设在入场价之外。"
          readOnly
        />
      </DraftAssetProvider>,
    );

    await waitFor(() => expect(bridgeRef.current).not.toBeNull());
    const paragraph = container.querySelector('[data-slate-node="element"]');
    expect(paragraph).not.toBeNull();

    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    const fragment = bridgeRef.current?.getFragmentForDomRange(range);

    expect(fragment).toEqual([
      expect.objectContaining({
        children: [expect.objectContaining({ text: '将止损设在入场价之外。' })],
        type: 'p',
      }),
    ]);
  });
});
