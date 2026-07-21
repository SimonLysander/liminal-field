/**
 * 构造可按字符串比较的目标写排序键：先比较 Mongo 分配的目标序号，
 * 再比较同一审批调用的重试序号。
 */
export function buildApprovalFence(
  targetSequence: number,
  commitVersion: number,
): string {
  return `${String(targetSequence).padStart(20, '0')}:${String(commitVersion).padStart(10, '0')}`;
}

/** 非审批写也写入排序屏障，避免更早创建的审批随后覆盖更新内容。 */
export function buildDirectWriteFence(targetSequence: number): string {
  return buildApprovalFence(targetSequence, 0);
}
