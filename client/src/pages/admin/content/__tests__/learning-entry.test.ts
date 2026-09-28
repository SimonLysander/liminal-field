import { describe, expect, it } from 'vitest';
import {
  buildStartLearningConfirmMessage,
  getLearningEntryState,
} from '../learning-entry';
import { buildLearningUrl, type LearningProjectResolve } from '@/services/learning';

describe('buildStartLearningConfirmMessage', () => {
  it('explains the selected page and scope before creating a learning project', () => {
    expect(buildStartLearningConfirmMessage('曝光三角形')).toBe(
      '将为「曝光三角形」开启学习空间。\n\n范围包含这个页面及下方的页面。下级页面已经开始的独立学习会保留，进入这些页面时仍继续原来的学习。',
    );
  });

  it.each([
    [null, 'loading'],
    [resolveState({ canStart: true }), 'available'],
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
    rootNode: currentNode,
    currentNode,
    path: [currentNode],
    ...overrides,
  };
}

describe('buildLearningUrl', () => {
  it('opens a learning root as a plan without a writer query', () => {
    expect(buildLearningUrl(resolveState({}))).toBe('/admin/notes/root/learn');
  });

  it('opens a descendant under its resolved nearest learning root', () => {
    const resolved = resolveState({});
    resolved.currentNode = { ...resolved.currentNode, id: 'leaf', contentItemId: 'ci_leaf' };
    expect(buildLearningUrl(resolved)).toBe('/admin/notes/root/learn?node=ci_leaf');
  });
});
