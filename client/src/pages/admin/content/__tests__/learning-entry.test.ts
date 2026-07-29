import { describe, expect, it } from 'vitest';
import {
  buildStartLearningConfirmMessage,
  getLearningEntryState,
} from '../learning-entry';
import type { LearningProjectResolve } from '@/services/learning';

describe('buildStartLearningConfirmMessage', () => {
  it('explains the selected page and scope before creating a learning project', () => {
    expect(buildStartLearningConfirmMessage('曝光三角形')).toBe(
      '将为「曝光三角形」开启学习空间。\n\n范围包含这个页面下方的所有页面；如果其中已有正在进行的学习，系统会阻止重复创建。',
    );
  });

  it.each([
    [null, 'loading'],
    [resolveState({ canStart: true }), 'available'],
    [
      resolveState({
        canStart: false,
        startBlockedReason: 'descendant-project',
      }),
      'blocked',
    ],
    [
      resolveState({
        canStart: false,
        project: {
          id: 'project-1',
          rootNodeId: 'root',
          rootContentItemId: 'ci_root',
          status: 'active',
        },
      }),
      'active',
    ],
  ] as const)('maps the resolver result to the %s entry state', (input, expected) => {
    expect(getLearningEntryState(input)).toBe(expected);
  });
});

function resolveState(
  overrides: Partial<LearningProjectResolve>,
): LearningProjectResolve {
  const currentNode = {
    id: 'root',
    name: 'Root',
    type: 'DOC' as const,
    scope: 'notes',
    contentItemId: 'ci_root',
    sortOrder: 0,
    hasChildren: false,
    createdAt: '2026-07-29T00:00:00.000Z',
  };

  return {
    project: null,
    canStart: true,
    startBlockedReason: null,
    rootNode: currentNode,
    currentNode,
    path: [currentNode],
    ...overrides,
  };
}
