/**
 * 给模型的带外反馈文案集中表 —— 短指令片段统一在此 ts 引出(载体原则:短→ts、长→md)。
 * 这些是「我们写给模型的话」,与工具描述同属可集中 review 的提示词;放此处单一真源、走 git。
 */

/** 一条已裁决的写操作(HITL 审批回灌用)。 */
export interface ResolvedWrite {
  toolName: string;
  status: string; // 'approved' | 'rejected'
}

/**
 * HITL 审批结果回灌:上一轮门禁写工具被带外批准/拒绝(模型当时不知道),
 * 这一轮把结果作为带外事实追加进 system,告诉模型据此继续、勿重复提议或假装已写。
 * 返回前导两个换行 + <approval_results> 段;无已裁决项时调用方不应调用本函数。
 */
export function approvalResultsFeedback(resolved: ResolvedWrite[]): string {
  const lines = resolved.map((r) => {
    const verb =
      r.status === 'approved' ? '已获用户批准并写入' : '被用户拒绝,未写入';
    return `- ${r.toolName}:${verb}`;
  });
  return `\n\n<approval_results>\n你之前提议的写操作,用户已裁决:\n${lines.join('\n')}\n据此继续:被批准的视为已落库,无需重复提议;被拒绝的不要假装写了,可问清原因或换思路。\n</approval_results>`;
}
