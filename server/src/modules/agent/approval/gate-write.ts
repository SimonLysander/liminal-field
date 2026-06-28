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
import { Logger } from '@nestjs/common';
import { PendingWriteRepository } from './pending-write.repository';
import { toolResult } from '../tools/tool-result';

// 模块级 logger:gateWrite 是工厂函数无 class 容器,沿用 skill.tool 同款 module-scope Logger。
const logger = new Logger('GateWrite');

/**
 * 审批卡的统一展示契约(三层)。所有门禁写工具的 buildPreview 一律产出这个 shape,
 * 前端卡片只认它、零 toolName 判断;tool 端各自把入参映射成它(内聚在 buildPreview 一处)。
 */
export interface ApprovalPreview {
  /** 顶:改动摘要(模型自述这次改了什么) */
  summary?: string;
  /** 中:改动预览——目录项 + 各自约 40 字内容片段 */
  items?: Array<{ label: string; snippet?: string }>;
  /** items 是否有序(true 显序号,如篇目;false 不显,如初稿小标题) */
  ordered?: boolean;
  /** 底:改动统计(一行量化,如「初稿 · 4410 字 · 覆盖现有」) */
  stats?: string;
}

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
  /** 把工具入参映射成审批卡的统一展示契约(三层) */
  buildPreview: (args: Record<string, unknown>) => ApprovalPreview;
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

    // ② 暂存到 pending_writes（TTL 24h 自动清理，不审批则自动过期）。
    //    buildPreview/stash 失败(如 Mongo 故障)不透传异常——带上下文 log 后回 error tool result,
    //    否则流层吞掉、服务端无痕(CLAUDE.md「catch 必 log / 关键写入失败带上下文」)。
    try {
      const preview = opts.buildPreview(args);
      // ApprovalPreview 严格类型不带 index signature,落 Mongo Mixed / 拼进 toolResult 处统一窄化为 Record
      const previewRecord = preview as Record<string, unknown>;
      await opts.pendingWriteRepo.stash({
        toolCallId,
        sessionKey: opts.sessionKey,
        toolName: opts.toolName,
        targetContentItemId: opts.targetContentItemId,
        agentKey: opts.agentKey,
        payload: args,
        preview: previewRecord,
        now: new Date(),
      });

      // ③ 返回 pending_approval：toolCallId 供前端定位审批卡，preview 供卡片三层展示
      return toolResult('已生成，待你在会话里确认', undefined, {
        status: 'pending_approval',
        toolCallId,
        ...previewRecord,
      });
    } catch (err) {
      const stack = err instanceof Error ? err.stack : String(err);
      logger.error(
        `gateWrite 暂存失败 toolName=${opts.toolName} sessionKey=${opts.sessionKey} toolCallId=${toolCallId} err=${stack}`,
      );
      return toolResult('暂存失败，请重试', undefined, { status: 'error' });
    }
  };

  // 展开 realTool 保留 description/inputSchema/parameters 等所有字段，仅覆盖 execute
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return { ...realTool, execute: gatedExecute };
}
