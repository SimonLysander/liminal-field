/**
 * DigestReport — 简报报告 entity（替代之前的 ContentItem 强接）。
 *
 * 设计哲学:简报跟笔记/文集是**完全不同**性质的数据——
 *   - 笔记: 用户心血手作,需要 git 版本管理 / 草稿-发布状态机 / 多 snapshot 历史
 *   - 简报: AI 量产 snapshot,每天 1 期,丢了 cron 能再来,旧的可丢
 *
 * 之前强接 ContentItem 导致一系列错配补丁(简报不该进 git / 不需要 publishedVersion
 * 状态机 / 删除要绕 publishedVersion 检查 / 不需要 NavNode 子节点树)。这一版抽出
 * 独立 entity,跟 DigestTask / SmartTopicConfig 共同构成 digest 模块的纯净数据模型。
 *
 * 字段:
 *   _id          dr_xxx 业务 id (跟 DigestTask 一样 prefix 区分)
 *   topicId      关联 SmartTopicConfig._id (或者 topic 的 ContentItem id,phase 2 再统一)
 *   taskId       关联 DigestTask._id (产出来源,前端可挂"调用链"按钮)
 *   headline     标题(compose 节点写的)
 *   markdown     正文 markdown 全文
 *   findings     复用 DigestTask.Finding 类型(citationId/title/url/sourceName/reason/snippet)
 *   publishedAt  发布时间 = createdAt 默认
 *
 * 索引: topicId + publishedAt(倒序) — 公开端 listByTopic 主路径
 */
import { modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Finding } from './digest-task.entity';

@modelOptions({
  schemaOptions: { collection: 'digest_reports', timestamps: true },
  options: { allowMixed: Severity.ALLOW },
})
export class DigestReport {
  /** dr_xxx 业务 id;迁移老数据时沿用旧 ContentItem.id(ci_xxx)以保持 URL 兼容 */
  @prop({ required: true })
  _id!: string;

  /** 关联 SmartTopicConfig._id (= 老的 topic ContentItem.id ci_xxx) */
  @prop({ required: true, index: true })
  topicId!: string;

  /** 关联 DigestTask._id (dt_xxx),前端"调用链"按钮跳转用 */
  @prop({ required: true })
  taskId!: string;

  /** 标题(headline) */
  @prop({ required: true })
  headline!: string;

  /** 正文 markdown 全文 */
  @prop({ required: true })
  markdown!: string;

  /** 引用条目(citationId / title / url / sourceName / reason / snippet);
   * 直接复用 DigestTask.Finding 类型——字段相同就别造重复定义。 */
  @prop({ type: () => [Finding], default: [] })
  findings!: Finding[];

  /** 发布时间;默认 = createdAt (timestamps 自动) */
  @prop({ required: true, type: () => Date })
  publishedAt!: Date;
}
