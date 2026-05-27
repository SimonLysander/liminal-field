import { createContext } from 'react';

/**
 * ProposalControlsContext —— 把 useProposalController 的裁决回调透传到深层 element renderer。
 *
 * 用途:proposal-old / proposal-new element renderer 渲染 ✓✗ 按钮时,通过 useContext
 * 拿到 acceptOne(hunkId) / rejectOne(hunkId) 回调。
 * 不通过 props 透传是因为 Plate element renderer 由 Plate 内部调度,中间层不可控。
 */
export interface ProposalControls {
  /** 接受某 hunk:对应节点改 type 或删除(由 controller 内部实现) */
  acceptOne: (hunkId: string) => void;
  /** 拒绝某 hunk:对应节点改 type 或删除(由 controller 内部实现) */
  rejectOne: (hunkId: string) => void;
}

export const ProposalControlsContext = createContext<ProposalControls | null>(null);
