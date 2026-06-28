/**
 * gate-write.ts — 通用 HITL 写工具门禁 wrapper。
 *
 * 把任何写工具包成「校验 → 暂存 → 返回 pending_approval」的门禁版本：
 * 1. 若 opts.validate 返回错误文案 → 直接回 invalid，不暂存（如 remember 的强校验）
 * 2. 否则把 toolCallId + 原始 args 暂存进 pending_writes，返回 pending_approval
 *
 * 审批路径由带外 REST 端点（POST /agent/writes/:id/approve|reject）完成，
 * 不干扰 streamText 单向流。
 *
 * 设计要点：
 * - 保留 realTool 的 description + inputSchema，AI SDK 仍能校验入参并展示工具描述
 * - execute 被替换为门禁逻辑；args 由 AI SDK 经 inputSchema 校验后传入，结构有保证
 * - 没有 sessionKey 时上游应退回直接用 realTool，避免「无法审批却又不写」的死局
 */
import { PendingWriteRepository } from './pending-write.repository';
import { toolResult } from '../tools/tool-result';

export interface GateWriteOptions {
  toolName: string;
  sessionKey: string;
  targetContentItemId?: string | null;
  agentKey?: string | null;
  pendingWriteRepo: PendingWriteRepository;
  /**
   * 写前校验（如 remember 的 observations 强校验）。
   * 入参是工具的完整 args 对象（Record<string, unknown>）；
   * 返回错误文案则不暂存、直接回 invalid。
   */
  validate?: (args: Record<string, unknown>) => string | null;
  /** 给审批卡的轻量预览（前端展示摘要用，不含正文） */
  buildPreview: (args: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * 包住真 tool：复制其所有字段（含 description / inputSchema / parameters），
 * 仅替换 execute 为门禁逻辑。
 *
 * @param realTool  原始工具对象（ai.tool() 的返回值）
 * @param opts      门禁选项
 * @returns         门禁后的工具对象，可直接传给 streamText({ tools })
 */
export function gateWrite(
  // realTool 是 ai.tool() 返回的工具对象；其结构由 AI SDK 保证，
  // 这里用 Record<string, unknown> 接收以安全展开所有字段。

  realTool: any,
  opts: GateWriteOptions,
): Record<string, unknown> {
  /**
   * 门禁版 execute：
   * 第二参 { toolCallId } 由 AI SDK 在调用时注入（ToolExecutionOptions）。
   * args 类型声明为 Record<string, unknown>：AI SDK 经 inputSchema 校验后传入，
   * 结构由 realTool 的 inputSchema 保证，此处做宽松接收以保持 wrapper 泛用性。
   */
  const gatedExecute = async (
    args: Record<string, unknown>,
    { toolCallId }: { toolCallId: string },
  ): Promise<string> => {
    // ① 写前校验（仅 remember 等有前置约束的工具需要，其它传 undefined 跳过）
    if (opts.validate) {
      const err = opts.validate(args);
      if (err != null) {
        return toolResult(err, undefined, { status: 'invalid' });
      }
    }

    const preview = opts.buildPreview(args);

    // ② 暂存到 pending_writes（TTL 24h 自动清理，不审批则自动过期）
    await opts.pendingWriteRepo.stash({
      toolCallId,
      sessionKey: opts.sessionKey,
      toolName: opts.toolName,
      targetContentItemId: opts.targetContentItemId,
      agentKey: opts.agentKey,
      payload: args,
      preview,
      now: new Date(),
    });

    // ③ 返回 pending_approval：toolCallId 供前端定位审批卡，preview 供卡片摘要展示
    return toolResult('已生成，待你在会话里确认', undefined, {
      status: 'pending_approval',
      toolCallId,
      ...preview,
    });
  };

  // 展开 realTool 保留 description/inputSchema/parameters 等所有字段，仅覆盖 execute
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return { ...realTool, execute: gatedExecute };
}
