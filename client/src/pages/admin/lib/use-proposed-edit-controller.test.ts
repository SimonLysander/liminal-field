import { describe, expect, it } from 'vitest';
import {
  getSuggestionResolveDescriptor,
} from './use-proposed-edit-controller';

type MockSuggestionData = {
  createdAt?: number;
  type?: 'insert' | 'remove' | 'replace' | 'update';
  userId?: string;
};

type MockSuggestionNode = Record<string, unknown> & {
  inlineId?: string;
  blockId?: string;
  inlineData?: MockSuggestionData;
  blockData?: MockSuggestionData;
};

function makeSuggestionApi() {
  return {
    nodeId: (node: MockSuggestionNode) => {
      if (typeof node.inlineId === 'string') return node.inlineId;
      return typeof node.blockId === 'string' ? node.blockId : undefined;
    },
    suggestionData: (node: MockSuggestionNode) => {
      if (node.inlineData && typeof node.inlineData === 'object') {
        return node.inlineData;
      }
      if (node.blockData && typeof node.blockData === 'object') {
        return node.blockData;
      }
      return undefined;
    },
  };
}

describe('getSuggestionResolveDescriptor', () => {
  it('inline suggestion 优先使用现成 keyId', () => {
    const api = makeSuggestionApi();
    const node = {
      inlineId: 'inline-1',
      inlineData: {
        createdAt: 123,
        type: 'insert',
        userId: 'aurora',
      },
      suggestion_inline_1: {
        createdAt: 123,
        type: 'insert',
        userId: 'aurora',
      },
    };

    const result = getSuggestionResolveDescriptor(api, node);

    expect(result).toMatchObject({
      suggestionId: 'inline-1',
      keyId: 'suggestion_inline_1',
      type: 'insert',
      userId: 'aurora',
    });
    expect(result?.createdAt).toEqual(new Date(123));
  });

  it('block suggestion 在没有 suggestion_xxx key 时回退到 getSuggestionKey(id)', () => {
    const api = makeSuggestionApi();
    const node = {
      blockId: 'block-1',
      blockData: {
        createdAt: 456,
        type: 'remove',
        userId: 'aurora',
      },
      suggestion: {
        id: 'block-1',
      },
    };

    const result = getSuggestionResolveDescriptor(api, node);

    expect(result).toMatchObject({
      suggestionId: 'block-1',
      keyId: 'suggestion_block-1',
      type: 'remove',
      userId: 'aurora',
    });
    expect(result?.createdAt).toEqual(new Date(456));
  });
});
