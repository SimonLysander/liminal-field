import { createContext } from 'react';

/**
 * ProposalControlsContext —— 把 useProposalController 的裁决回调 + 当前 active hunk
 * 透传到深层 element renderer。
 *
 * 用途:
 *   - proposal-old / proposal-new element 渲染 ✓✗ 按钮时,通过 useContext
 *     拿到 acceptOne(hunkId) / rejectOne(hunkId) 回调
 *   - 同时读 activeHunkId 判断当前 element 是不是被"聚焦"的 hunk(用于高亮 + 滚动)
 *   - 用户点击节点区域时调 setActiveHunkId 切焦点(让快捷键 Y/N 操作目标跟随)
 *
 * 不通过 props 透传是因为 Plate element renderer 由 Plate 内部调度,中间层不可控。
 */
export interface ProposalControls {
  /** 接受某 hunk:对应节点改 type 或删除(由 controller 内部实现) */
  acceptOne: (hunkId: string) => void;
  /** 拒绝某 hunk:对应节点改 type 或删除(由 controller 内部实现) */
  rejectOne: (hunkId: string) => void;
  /** 当前聚焦的 hunk id(快捷键 Y/N 的操作目标 + 视觉高亮锚) */
  activeHunkId?: string;
  /** 用户点击 hunk 区域时切焦点(导航辅助) */
  setActiveHunkId: (id: string | undefined) => void;
}

export const ProposalControlsContext = createContext<ProposalControls | null>(null);
