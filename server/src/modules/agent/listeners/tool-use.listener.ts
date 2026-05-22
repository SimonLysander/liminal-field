/**
 * ToolUseListener — 监听 agent.afterToolUse 事件，记录工具调用日志。
 *
 * 设计：把工具调用日志从 AgentService 的 onStepFinish 回调中解耦，
 * 日志记录逻辑独立可扩展（将来可以加统计、告警等）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class ToolUseListener {
  private readonly logger = new Logger(ToolUseListener.name);

  /** 同步事件处理，只做日志记录，无需 async */
  @OnEvent('agent.afterToolUse')
  handleToolUse(payload: {
    stepNumber: number;
    toolCalls: Array<{ toolName: string }>;
  }): void {
    if (payload.toolCalls.length > 0) {
      this.logger.log(
        `Step ${payload.stepNumber}: ${payload.toolCalls.map((t) => t.toolName).join(', ')}`,
      );
    }
  }
}
