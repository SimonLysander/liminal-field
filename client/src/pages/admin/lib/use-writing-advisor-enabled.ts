/*
 * useWritingAdvisorEnabled — 读取 writing-advisor 入口配置的 enabled 开关。
 *
 * 笔记 / 文集条目两个编辑页都按此开关决定是否渲染写作顾问栏,逻辑逐字相同,抽到这里去重。
 * 默认 true,拉取失败静默(不阻塞编辑页);拿到配置后以入口的 enabled 为准(无该入口视为关闭)。
 */

import { useEffect, useState } from 'react';
import { settingsApi } from '@/services/settings';

export function useWritingAdvisorEnabled(): boolean {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    settingsApi
      .getAgentConfigs()
      .then((configs) => {
        const writingAdvisor = configs.find((c) => c.key === 'writing-advisor');
        setEnabled(writingAdvisor?.enabled ?? false);
      })
      .catch(() => {});
  }, []);
  return enabled;
}
