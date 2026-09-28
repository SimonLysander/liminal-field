import { useCallback, useEffect, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { learningApi, type LearningProjectResolve } from '@/services/learning';
import { structureApi } from '@/services/structure';

const logger = createLogger('learning-route');

/** 先确认页面当前归属，再允许挂载规划或正文编辑器。旧链接也必须经过此边界。 */
export function useLearningRoute(topicNavId: string, contentItemId: string | null) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([topicNavId, contentItemId, revision]);
  const [result, setResult] = useState<{
    key: string;
    resolved: LearningProjectResolve | null;
    error: string | null;
  } | null>(null);
  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      try {
        let nodeId = topicNavId;
        if (contentItemId) {
          const path = await structureApi.getPathByContentItemId(contentItemId);
          if (!path.some((node) => node.id === topicNavId)) {
            throw new Error('该页面已不在当前学习目录中，请从笔记列表重新进入');
          }
          nodeId = path.at(-1)?.id ?? '';
        }
        if (cancelled) return;
        const resolved = await learningApi.resolve(nodeId);
        // 再检查权威路径，避免两次读取之间页面被移出当前目录。
        if (!resolved.path.some((node) => node.id === topicNavId)) {
          throw new Error('该页面已不在当前学习目录中，请从笔记列表重新进入');
        }
        if (!resolved.project || !resolved.currentNode.contentItemId) {
          throw new Error('该页面尚未开始学习，请从笔记列表进入');
        }
        if (!cancelled) setResult({ key, resolved, error: null });
      } catch (cause) {
        if (cancelled) return;
        logger.warn('resolve_failed', {
          topicNavId,
          contentItemId,
          error: cause instanceof Error ? cause.message : String(cause),
        });
        setResult({
          key,
          resolved: null,
          error: cause instanceof Error ? cause.message : '读取学习归属失败',
        });
      }
    }
    void resolve();
    return () => { cancelled = true; };
  }, [topicNavId, contentItemId, key]);

  // 参数变化的第一帧不能沿用上一页的角色；清理函数处理晚到的旧响应。
  return {
    loading: result?.key !== key,
    resolved: result?.key === key ? result.resolved : null,
    error: result?.key === key ? result.error : null,
    retry,
  };
}
