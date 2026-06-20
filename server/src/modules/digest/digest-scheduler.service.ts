/**
 * DigestSchedulerService — 智能采集事项定时调度管理。
 *
 * 负责将 SmartTopicConfig.cron 注册为 @nestjs/schedule SchedulerRegistry 中的 CronJob，
 * 从而实现事项自动按计划触发工作流。
 *
 * 生命周期：
 *   - onModuleInit：启动时扫描所有 enabled=true 的 SmartTopicConfig，逐个注册 cron job
 *   - registerJob：注册（或替换）一个事项的 cron job（create/update 事项后调用）
 *   - unregisterJob：注销一个事项的 cron job（delete 事项前 / disabled 后调用）
 *   - reschedule：综合 enabled 状态决定 register 或 unregister（TopicService 统一调用此方法）
 *
 * job 命名规则：`digest:${contentItemId}` — 全局唯一，避免冲突。
 *
 * 设计决策：SchedulerRegistry 由 ScheduleModule.forRoot() 全局注册（AppModule 已引入），
 * 无需在 DigestModule 重复声明。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { SmartTopicConfigRepository } from './smart-topic-config.repository';
import type { SmartTopicConfig } from './smart-topic-config.entity';
import type { DigestWorkflowService } from './workflow/digest-workflow.service';

@Injectable()
export class DigestSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(DigestSchedulerService.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly stcRepo: SmartTopicConfigRepository,
    private readonly workflow: DigestWorkflowService,
  ) {}

  async onModuleInit(): Promise<void> {
    const configs = await this.stcRepo.findEnabled();
    for (const config of configs) {
      this.registerJob(config);
    }
    this.logger.log(
      `[digest-scheduler] registered ${configs.length} cron jobs on startup`,
    );
  }

  /**
   * 注册（或替换）一个事项的 cron job。
   * 已存在同名 job 时先 unregister 再重新注册，避免重复。
   */
  registerJob(config: SmartTopicConfig): void {
    const name = this.jobNameOf(config.contentItemId);

    // 避免 duplicate name 错误，先摘除旧 job
    if (this.registry.getCronJobs().has(name)) {
      this.unregisterJob(config.contentItemId);
    }

    try {
      const job = new CronJob(config.cron, () => {
        this.logger.log(
          `[digest-scheduler] cron triggered topic=${config.contentItemId}`,
        );
        // fire-and-forget，失败在此捕获，不影响调度器本身
        void this.workflow
          .runOnce(config.contentItemId)
          .catch((err: unknown) => {
            this.logger.error(
              `[digest-scheduler] cron run failed topic=${config.contentItemId}`,
              err instanceof Error ? err.stack : undefined,
            );
          });
      });
      this.registry.addCronJob(name, job);
      job.start();
      this.logger.log(
        `[digest-scheduler] registered job=${name} cron='${config.cron}'`,
      );
    } catch (err: unknown) {
      // cron 表达式非法时 CronJob 构造会抛，捕获避免阻断其他事项注册
      this.logger.error(
        `[digest-scheduler] register failed topic=${config.contentItemId} cron='${config.cron}'`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /** 注销并停止一个事项的 cron job。job 不存在时静默忽略。 */
  unregisterJob(contentItemId: string): void {
    const name = this.jobNameOf(contentItemId);
    if (this.registry.getCronJobs().has(name)) {
      this.registry.deleteCronJob(name);
      this.logger.log(`[digest-scheduler] unregistered job=${name}`);
    }
  }

  /**
   * 根据 enabled 状态决定注册或注销（TopicService create/update/delete 后调用）。
   * enabled=true → registerJob，enabled=false → unregisterJob。
   */
  reschedule(config: SmartTopicConfig): void {
    if (config.enabled) {
      this.registerJob(config);
    } else {
      this.unregisterJob(config.contentItemId);
    }
  }

  private jobNameOf(contentItemId: string): string {
    return `digest:${contentItemId}`;
  }
}
