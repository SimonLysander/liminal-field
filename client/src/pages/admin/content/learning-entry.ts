import type { LearningProjectResolve } from '@/services/learning';
import type { LearningEntryState } from '../types';

export function getLearningEntryState(
  resolved: LearningProjectResolve | null,
): LearningEntryState {
  if (!resolved) return 'loading';
  if (resolved.project) return 'active';
  return 'available';
}

export function buildStartLearningConfirmMessage(rootName: string): string {
  return `将为「${rootName}」开启学习空间。\n\n范围包含这个页面及下方的页面。下级页面已经开始的独立学习会保留，进入这些页面时仍继续原来的学习。`;
}
