/**
 * CompactionListener — 监听 agent.afterChat 事件，异步触发 compaction 检查。
 *
 * 设计：把 compaction 从同步调用链中解耦出来，
 * onAfterChat 发事件后立即返回，compaction 在后台执行，不阻塞前端响应。
 */
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CompactionService } from '../session/compaction.service';

@Injectable()
export class CompactionListener {
  constructor(private readonly compactionService: CompactionService) {}

  /**
   * async: true 表示事件处理是异步的，EventEmitter2 不等待完成就继续。
   * compaction 失败不应影响主流程，CompactionService 内部已有 try/catch 保障。
   */
  @OnEvent('agent.afterChat', { async: true })
  async handleAfterChat(payload: {
    agentKey: string;
    sessionKey?: string;
    window: number;
  }): Promise<void> {
    await this.compactionService.compactIfNeeded(
      payload.agentKey,
      payload.window,
      payload.sessionKey,
    );
  }
}
