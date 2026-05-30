import { describe, expect, it } from 'vitest';
import {
  ReferenceRegistry,
  createEditSession,
  getMessageReferences,
  isEditConfirmation,
  isReferenceEditRequest,
} from './edit-session';
import type { ChatReferenceSnapshot } from '@/pages/admin/lib/live-chat-selection';

const refA: ChatReferenceSnapshot = {
  id: 'ref-a',
  order: 1,
  text: '第一段',
  preview: '第一段',
  anchor: {
    type: 'range',
    blockIndex: 12,
    startPath: [12, 0],
    endPath: [15, 0],
  },
};

const refB: ChatReferenceSnapshot = {
  id: 'ref-b',
  order: 2,
  text: '第二段',
  preview: '第二段',
  anchor: {
    type: 'range',
    blockIndex: 17,
    startPath: [17, 0],
    endPath: [18, 0],
  },
};

describe('edit session primitives', () => {
  it('keeps references in an explicit registry keyed by ref id', () => {
    const registry = new ReferenceRegistry();

    registry.registerMany([refA]);
    registry.registerMany([refB]);

    expect(registry.get('ref-a')).toBe(refA);
    expect(registry.getMany(['ref-b', 'missing'])).toEqual([refB]);
  });

  it('hydrates the registry from message metadata without relying on message order lookups later', () => {
    const registry = new ReferenceRegistry();

    registry.hydrateFromMessages([
      { metadata: { references: [refA] } },
      { metadata: { references: [refB] } },
    ]);

    expect(registry.get('ref-a')?.anchor).toEqual(refA.anchor);
    expect(registry.get('ref-b')?.anchor).toEqual(refB.anchor);
  });

  it('creates active edit sessions from target references', () => {
    const session = createEditSession([refA, refB], 'references');

    expect(session?.targets.map((target) => target.id)).toEqual(['ref-a', 'ref-b']);
    expect(session?.targets.map((t) => t.anchor)).toEqual([refA.anchor, refB.anchor]);
  });

  it('recognizes short apply confirmations but not substantive new requests', () => {
    expect(isEditConfirmation('换')).toBe(true);
    expect(isEditConfirmation('用这个。')).toBe(true);
    expect(isEditConfirmation('重新分析一下整篇结构')).toBe(false);
  });

  it('separates reference context from edit intent', () => {
    expect(isReferenceEditRequest('润色这个')).toBe(true);
    expect(isReferenceEditRequest('你怎么看这个')).toBe(false);
  });

  it('validates reference metadata shape', () => {
    expect(getMessageReferences({ references: [refA, { id: 'bad' }] })).toEqual([refA]);
    expect(getMessageReferences(undefined)).toEqual([]);
  });
});
