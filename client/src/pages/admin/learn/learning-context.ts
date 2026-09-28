import type { LearningData } from './useLearningData';

type ContextData = Pick<LearningData, 'topicTitle' | 'topicContentItemId' | 'allChapters' | 'plan'>;

export function buildLearningContext(
  data: ContextData,
  current: { isTopic: boolean; contentItemId: string | null; title: string },
): string {
  // 结构可见性不等于学习归属：独立学习保留入口和 ID，不作为空篇目处理。
  const ref = (title: string, id: string | null) => `《${title}》(ID:${id ?? '—'})`;
  const overview = data.plan?.goal ? `(概要:${data.plan.goal})` : '';
  const location = current.isTopic
    ? `在规划 ${ref(data.topicTitle, current.contentItemId)}${overview}。`
    : `在写 ${ref(current.title, current.contentItemId)},所属 ${ref(data.topicTitle, data.topicContentItemId)}${overview}。`;
  if (data.allChapters.length === 0) {
    return `${location}\n《${data.topicTitle}》的篇目:(还没建,照规划新建一篇)`;
  }

  const hasIndependentLearning = data.allChapters.some((chapter) => chapter.isIndependentLearningRoot);
  const entries = data.allChapters.map((chapter, index) => {
    const state = chapter.isIndependentLearningRoot
      ? '独立学习（单独管理，未查询研究进度）'
      : chapter.studied ? '已研究' : '尚无 AI 初稿';
    const marker = chapter.contentItemId === current.contentItemId ? ' ←当前' : '';
    return `  ${index + 1}. ${'  '.repeat(chapter.depth)}${ref(chapter.title, chapter.contentItemId)} ${state}${marker}`;
  });
  const ownership = hasIndependentLearning
    ? '\n独立学习仍是本主题下的篇目；其学习进度和初稿写入由自身学习管理，目录仅列出入口，不展开其后代。'
    : '';
  return `${location}\n《${data.topicTitle}》的篇目目录(共 ${data.allChapters.length} 个节点):\n${entries.join('\n')}${ownership}`;
}
