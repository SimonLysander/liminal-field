/**
 * scheduleUtils — Schedule ↔ Cron 双向转换工具
 *
 * 独立 .ts 文件避免与 react-refresh/only-export-components 规则冲突：
 * DigestTopicForm.tsx 只 export 组件，工具函数从此文件 import。
 */

export type Schedule =
  | { mode: 'manual' }
  | { mode: 'daily'; hour: number }
  | { mode: 'weekly'; weekday: number; hour: number }
  | { mode: 'every-n-days'; intervalDays: number; hour: number };

/** Schedule → cron 字符串，manual 给一个极低频 cron（后端靠 enabled=false 不注册） */
export function scheduleToCron(s: Schedule): string {
  switch (s.mode) {
    case 'manual':        return '0 0 1 1 0';
    case 'daily':         return `0 ${s.hour} * * *`;
    case 'weekly':        return `0 ${s.hour} * * ${s.weekday}`;
    case 'every-n-days':  return `0 ${s.hour} */${s.intervalDays} * *`;
  }
}

/** cron 字符串 → Schedule，识别 4 种已知模式；不认识的 fallback manual */
export function cronToSchedule(cron: string): Schedule {
  const parts = cron.split(' ');
  if (parts.length !== 5) return { mode: 'manual' };
  const [min, hour, dom, , dow] = parts;
  if (min !== '0') return { mode: 'manual' };
  const h = parseInt(hour, 10);
  if (Number.isNaN(h)) return { mode: 'manual' };
  if (dom === '*' && dow === '*') return { mode: 'daily', hour: h };
  if (dom === '*' && /^\d$/.test(dow)) return { mode: 'weekly', weekday: parseInt(dow, 10), hour: h };
  if (dom.startsWith('*/') && dow === '*') {
    const interval = parseInt(dom.slice(2), 10);
    if (!Number.isNaN(interval)) return { mode: 'every-n-days', intervalDays: interval, hour: h };
  }
  return { mode: 'manual' };
}
