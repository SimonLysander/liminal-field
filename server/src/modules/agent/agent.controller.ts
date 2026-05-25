/**
 * AgentController — Agent 对话的 HTTP 接口。
 *
 * 接口列表：
 * - POST   /agent/chat              SSE 流式对话
 * - GET    /agent/sessions/:key     加载会话历史（含自动召回的相关记忆）
 * - PUT    /agent/sessions/:key     保存会话消息（触发异步 compaction）
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
  Post,
  Put,
  Query,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
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
  async chat(
    @Body() dto: AgentChatDto,
    @Res() reply: FastifyReply,
    @Req() req: FastifyRequest,
  ) {
    // AbortController：客户端断开连接时取消 LLM 流式请求
    const abortController = new AbortController();
    req.raw.on('close', () => abortController.abort());

    const result = await this.agentService.chat(dto, abortController.signal);

    // Fastify reply.send() 支持 Web API Response，直接转发 SSE 流
    return reply.send(result.toUIMessageStreamResponse());
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
   * 加载会话历史。
   * title 参数用于自动召回相关记忆，前端在编辑器入口打开对话时传入文档标题。
   */
  @Get('agent/sessions/:key')
  async getSession(@Param('key') key: string, @Query('title') title?: string) {
    return this.lifecycle.onSessionLoad(key, title);
  }

  /**
   * 保存会话消息。前端在每次 AI 回复完成后调用。
   * 保存后通过事件异步触发 compaction（不阻塞响应）。
   * 返回当前 tasks，前端用于更新 TaskBar。
   */
  @Put('agent/sessions/:key')
  async saveSession(
    @Param('key') key: string,
    @Body('messages') messages: Record<string, unknown>[] = [],
  ) {
    await this.lifecycle.onAfterChat(key, messages);
    const tasks = await this.lifecycle.getSessionTasks(key);
    return { ok: true, tasks };
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
