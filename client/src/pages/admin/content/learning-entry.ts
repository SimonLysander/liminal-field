import type { LearningProjectResolve } from '@/services/learning';
import type { LearningEntryState } from '../types';

export function getLearningEntryState(
  resolved: LearningProjectResolve | null,
): LearningEntryState {
  if (!resolved) return 'loading';
  if (resolved.project) return 'active';
  if (resolved.startBlockedReason === 'descendant-project') return 'blocked';
  return 'available';
}

export function buildStartLearningConfirmMessage(rootName: string): string {
  return `将为「${rootName}」开启学习空间。\n\n范围包含这个页面下方的所有页面；如果其中已有正在进行的学习，系统会阻止重复创建。`;
}
