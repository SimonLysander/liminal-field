/**
 * SkillSlashPopover — advisor 输入框 `/` autocomplete 浮层(spec §5.3)。
 *
 * 设计意图:
 * - 用户在 advisor 输入框敲 `/` → 浮层列当前 agent 已启用的 Skills,作为
 *   "提示词糖":选中后把输入框前缀替换成 `/skill_name `,后端 agent prompt
 *   已注入 <available_skills> 元数据(Phase 1 Task 1.3),看到这个前缀就会
 *   主动调用 Skill 工具拉 body —— 跟自动 invoke 走同一后端链路。
 *
 * 关键约束(Phase 4 Task 4.1):
 * - 只挂在 advisor composer 内,绝不影响主文档 Plate 编辑器 SlashKit。
 *   advisor composer 的 Plate 编辑器并没有装 SlashKit(只装了 ReferenceTokenPlugin),
 *   所以这里的 `/` 监听跟主编辑器的块命令零冲突。
 * - skills 空数组 → 浮层不渲染(open=true 但没候选时静默,不弹空壳)。
 *
 * UI 规格(对齐 ChipSelector 设计):
 * - bg-popover + border var(--separator) + rounded-xl(项目 popover 标准)
 * - 选中态 bg-shelf
 * - description 用 text-2xs + ink-ghost 副标记
 *
 * 受控:
 * - open / query 由父组件(AdvisorSidebar)管,父组件从 composer 文本变化推 query。
 * - onPick(name) → 父组件触发 composer 文本替换 + 关浮层。
 * - onClose() → Esc 或失去焦点。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Skill } from '@/services/skills';
import { filterSkillsByQuery } from './slash-text-utils';

interface Props {
  /** 浮层显示开关(由父组件根据文本是否以 / 开头判定) */
  open: boolean;
  /** 当前 agent 已启用的 Skill 列表(空 → 浮层不渲染) */
  skills: Skill[];
  /** 当前输入文本(全文)。组件内只取以 `/` 开头部分做匹配 */
  query: string;
  /** 选中某 skill name → 父组件改写 composer 文本并关浮层 */
  onPick: (skillName: string) => void;
  /** Esc 或外部点击触发 */
  onClose: () => void;
}

export function SkillSlashPopover({
  open,
  skills,
  query,
  onPick,
  onClose,
}: Props) {
  // 候选列表(每次 query/skills 变化重算)
  const candidates = useMemo(
    () => filterSkillsByQuery(skills, query),
    [skills, query],
  );

  // 高亮项索引(↑↓ 键移动)。query/候选数变化时回到首项 —— 不在 effect 里 setState,
  // 走 React 19 推荐套路:state 跟一个 "version key",key 变就用初始值,避免 cascading render。
  const candidateKey = `${query}|${candidates.length}`;
  const [activeState, setActiveState] = useState<{ key: string; index: number }>(
    { key: candidateKey, index: 0 },
  );
  // 同步阶段比对:key 不同就重置(纯函数式,跟 useState 派生 state 推荐写法对齐)。
  const activeIndex =
    activeState.key === candidateKey ? activeState.index : 0;
  const setActiveIndex = useCallback(
    (next: number | ((prev: number) => number)) => {
      setActiveState((prev) => {
        const baseIndex = prev.key === candidateKey ? prev.index : 0;
        const nextIndex =
          typeof next === 'function' ? next(baseIndex) : next;
        return { key: candidateKey, index: nextIndex };
      });
    },
    [candidateKey],
  );

  // 把 onPick / onClose 装进 ref,避免下面 keydown effect 闭包过期。
  // 父组件每次 render 给的可能是新函数(useCallback 有 deps),但我们的键盘
  // 处理只需要拿到"当前最新"那个,不必每次 deps 变化就重挂监听。
  const onPickRef = useRef(onPick);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // 全局键盘监听:浮层是受控浮层、父组件的 Plate 编辑器抢焦点,
  // 不在浮层 DOM 内监听 keydown 是抓不到 ↑↓/Enter/Esc 的。
  // 用 capture phase 在 Plate 编辑器的 keydown 之前抢一次,
  // 命中 ↑↓/Enter/Esc 就 preventDefault 不让 composer 收到。
  useEffect(() => {
    if (!open || candidates.length === 0) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % candidates.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        // 阻止 composer 的 Enter=send,本帧仅作"选 skill"。
        event.stopPropagation();
        const picked = candidates[activeIndex];
        if (picked) onPickRef.current(picked.name);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    // capture=true:在 React event 之前先抢到,确保 preventDefault 生效。
    window.addEventListener('keydown', handler, { capture: true });
    return () => {
      window.removeEventListener('keydown', handler, { capture: true });
    };
  }, [open, candidates, activeIndex, setActiveIndex]);

  // skills 空或 query 不匹配 → 不渲染浮层(测试约束:空时无 listbox)
  if (!open || candidates.length === 0) return null;

  return (
    <div
      // 锚定到 composer 上方(absolute 由父容器 relative 撑住),
      // 视觉规格跟项目 popover 一致:rounded-xl + border separator + 阴影
      role="listbox"
      aria-label="Skill 命令候选"
      className="absolute bottom-full left-0 right-0 z-[var(--z-dropdown)] mb-2 max-h-60 overflow-y-auto rounded-xl border border-[var(--separator)] bg-popover p-1 shadow-[0_4px_14px_rgba(0,0,0,.06),0_18px_44px_rgba(0,0,0,.14)]"
    >
      {candidates.map((skill, idx) => {
        const active = idx === activeIndex;
        return (
          <div
            key={skill._id}
            role="option"
            aria-selected={active}
            // mousedown 而非 click:Plate 编辑器在 click 之前会先收到 blur,
            // mousedown 上先 preventDefault 才能保住焦点链;但这里浮层关闭就好,
            // 用 onMouseDown 确保选中时 composer 还没失焦,父组件能稳替换文本。
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(skill.name);
            }}
            onMouseEnter={() => setActiveIndex(idx)}
            className={
              'flex cursor-pointer flex-col items-start gap-0.5 rounded px-2 py-1.5 text-sm transition-colors ' +
              (active ? 'bg-[var(--shelf)]' : 'hover:bg-[var(--shelf)]')
            }
          >
            <span style={{ color: 'var(--ink)' }}>{skill.name}</span>
            {skill.description && (
              <span
                className="text-2xs"
                style={{ color: 'var(--ink-ghost)' }}
              >
                {skill.description}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
