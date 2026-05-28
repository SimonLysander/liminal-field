/**
 * AgentController — Agent 对话的 HTTP 接口。
 *
 * 接口列表：
 * - POST   /agent/chat              SSE 流式对话(上下文组装 + 持久化全在 service)
 * - GET    /agent/sessions/:key     加载会话历史（含自动召回的相关记忆）
 * - DELETE /agent/sessions/:key     删除会话（清空对话历史）
 *
 * 设计：Controller 只做参数解析和 HTTP 协议处理，
 * 业务编排全部委托给 AgentLifecycle。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  Sse,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Observable } from 'rxjs';
import { RawResponse } from '../../common/raw-response.decorator';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgentService } from './agent.service';
import { AgentLifecycle } from './lifecycle/agent-lifecycle.service';
import { AgentMemoryRepository } from './memory/agent-memory.repository';
import type { AgentMemoryType } from './memory/agent-memory.entity';
import { AgentChatDto } from './dto/agent-chat.dto';

@Controller()
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly lifecycle: AgentLifecycle,
    private readonly memoryRepo: AgentMemoryRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @RawResponse()
  @Post('agent/chat')
  async chat(@Body() dto: AgentChatDto, @Res() reply: FastifyReply) {
    // 上下文组装 + 持久化(onFinish/consumeStream)全在 service 内;
    // service 直接返回 Web Response,这里只负责转发 SSE 流。
    const response = await this.agentService.chat(dto);
    return reply.send(response);
  }

  /**
   * 子 agent 实时进度推送（SSE）。
   *
   * 使用 NestJS 内置 @Sse() 装饰器，框架负责 SSE 协议和平台适配。
   * EventEmitter 事件 → Observable → SSE stream。
   */
  @Sse('agent/sub-agent-progress')
  subAgentProgress(
    @Query('sessionKey') sessionKey: string,
  ): Observable<MessageEvent> {
    const emitter = this.eventEmitter;

    return new Observable((subscriber) => {
      const stepHandler = (event: {
        sessionKey: string;
        step: number;
        tools: Array<{ name: string; args: string }>;
      }) => {
        if (event.sessionKey !== sessionKey) return;
        subscriber.next({
          data: JSON.stringify({
            type: 'step',
            step: event.step,
            tools: event.tools,
          }),
        });
      };

      const doneHandler = (event: { sessionKey: string }) => {
        if (event.sessionKey !== sessionKey) return;
        subscriber.next({
          data: JSON.stringify({ type: 'done' }),
        });
        subscriber.complete();
      };

      emitter.on('sub-agent.step', stepHandler);
      emitter.on('sub-agent.done', doneHandler);

      return () => {
        emitter.off('sub-agent.step', stepHandler);
        emitter.off('sub-agent.done', doneHandler);
      };
    });
  }

  /**
   * 加载会话历史（支持跨段聚合分页）。
   *
   * 分页参数（游标：绝对 index）：
   * - before：取此 index 之前的消息，无则取最近 limit 条（初始加载）
   * - limit：每页条数，默认 50
   * 响应额外包含 hasMore（是否有更早历史）+ firstIndex（下次传 before 的值）。
   */
  @Get('agent/sessions/:key')
  async getSession(
    @Param('key') key: string,
    @Query('agentInstanceKey') agentInstanceKey?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const beforeIdx = before !== undefined ? parseInt(before, 10) : undefined;
    const limitNum = limit !== undefined ? parseInt(limit, 10) : undefined;
    return this.lifecycle.onSessionLoad(
      key,
      beforeIdx,
      limitNum,
      agentInstanceKey,
    );
  }

  @Get('agent/session-groups/:agentInstanceKey/sessions')
  async listBusinessSessions(
    @Param('agentInstanceKey') agentInstanceKey: string,
  ) {
    return this.lifecycle.listBusinessSessions(agentInstanceKey);
  }

  @Patch('agent/sessions/:key/title')
  async renameBusinessSession(
    @Param('key') key: string,
    @Body('title') title: string,
  ) {
    await this.lifecycle.renameBusinessSession(key, title ?? '');
    return { ok: true };
  }

  /** 删除会话（清空对话历史）。 */
  @Delete('agent/sessions/:key')
  async deleteSession(@Param('key') key: string) {
    await this.lifecycle.onSessionDelete(key);
    return { ok: true };
  }

  // ── 记忆管理（管理端用） ────────────────────────────────

  /** 获取所有记忆 */
  @Get('agent/memories')
  async listMemories() {
    return this.memoryRepo.findAll();
  }

  /** 更新记忆（by _id） */
  @Put('agent/memories/:id')
  async updateMemory(
    @Param('id') id: string,
    @Body() dto: { type?: AgentMemoryType; title?: string; content?: string },
  ) {
    const updated = await this.memoryRepo.updateById(id, dto);
    if (!updated) {
      throw new Error(`Memory not found: ${id}`);
    }
    return updated;
  }

  /** 删除记忆（by _id） */
  @Delete('agent/memories/:id')
  async deleteMemory(@Param('id') id: string) {
    await this.memoryRepo.deleteById(id);
    return { ok: true };
  }
}
