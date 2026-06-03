/**
 * slash-text-utils — advisor 输入框 `/` 命令相关的纯函数。
 *
 * 抽出来到独立文件,避开 react-refresh 「只导出组件」的限制
 * (AiReferenceComposer / SkillSlashPopover 是组件文件,不能混导工具函数)。
 */

import type { Skill } from '@/services/skills';

/**
 * filterSkillsByQuery — query 跟 skills 列表匹配出候选。
 *
 * 规则:
 * - query 必须以 `/` 开头才返回非空(防止误触)
 * - 大小写不敏感
 * - 子串匹配 skill.name(displayName 暂不参与,保持 slash 语义=name 直接命中)
 */
export function filterSkillsByQuery(skills: Skill[], query: string): Skill[] {
  if (!query.startsWith('/')) return [];
  if (skills.length === 0) return [];
  const needle = query.slice(1).toLowerCase().trim();
  if (needle === '') return skills;
  return skills.filter((s) => s.name.toLowerCase().includes(needle));
}

/**
 * replaceSlashTokenInText — Skill slash 选中后的文本改写。
 *
 * 规则:
 *   1. 找文本里第一个 `/` 起始 token(到首个空白前)
 *   2. 用 `/skillName ` 替换
 *   3. 没找到 → 在最前插入 `/skillName `(防退化)
 *
 * 例子:
 *   '/cri 这段写得怎么样'   + 'critic' → '/critic 这段写得怎么样'
 *   '/   后面有句话'        + 'critic' → '/critic   后面有句话'(/ 后立刻没有 token 也接受)
 *   '没斜杠'                 + 'critic' → '/critic 没斜杠'
 *   '/abc/def 怪输入'        + 'critic' → '/critic /def 怪输入'(只换首 token)
 */
export function replaceSlashTokenInText(
  currentText: string,
  skillName: string,
): string {
  const slashIdx = currentText.indexOf('/');
  if (slashIdx < 0) {
    const rest = currentText.replace(/^\s+/, '');
    return rest ? `/${skillName} ${rest}` : `/${skillName} `;
  }
  const before = currentText.slice(0, slashIdx);
  const afterSlash = currentText.slice(slashIdx + 1);
  const wsMatch = afterSlash.match(/^\S*/);
  const tokenEnd = wsMatch ? wsMatch[0].length : 0;
  const rest = afterSlash.slice(tokenEnd);
  return `${before}/${skillName}${
    rest.startsWith(' ') ? rest : ' ' + rest.replace(/^\s+/, '')
  }`;
}
