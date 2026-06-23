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
 *   periodKey    所属「期」的周期标识(YYYY-MM-DD,周期起点本地日期,见 period.util)
 *   taskId       关联 DigestTask._id (产出来源,前端可挂"调用链"按钮)
 *   headline     标题(compose 节点写的)
 *   markdown     正文 markdown 全文
 *   findings     复用 DigestTask.Finding 类型(citationId/title/url/sourceName/reason/snippet)
 *   publishedAt  发布时间 = createdAt 默认
 *
 * 索引:
 *   - topicId + publishedAt(倒序) — 公开端 listByTopic / sibling 导航主路径
 *   注:periodKey **不再 unique** —— 每次运行各存独立一份报告(旧版保留、不覆盖),
 *   periodKey 只作"第几期"标记;展示端按 periodKey 分组取每期最新一份给读者,
 *   管理端列出全部(每个 task ↔ 各自 report 一对一,删除清晰)。
 */
import { index, modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Finding } from './digest-task.entity';

@index({ topicId: 1, publishedAt: -1 })
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

  /** 所属「期」的周期标识(YYYY-MM-DD,周期起点本地日期,由 period.util.computePeriodKey 算)。
   *  不再 unique:同一周期重复运行各存独立一份(旧版保留)。periodKey 用于展示端"按期取最新"分组。
   *  required — 新生成必带。 */
  @prop({ required: true })
  periodKey!: string;

  /** 关联 DigestTask._id (dt_xxx),前端"调用链"按钮跳转用 */
  @prop({ required: true })
  taskId!: string;

  /** 标题(headline) */
  @prop({ required: true })
  headline!: string;

  /** 本期 deck — "本期 N 篇:主题 1 / 主题 2 / 主题 3" 形式的目录式概要,
   *  紧贴 headline 下方 italic 大字渲染,告诉读者"这一期里有哪几篇/讲什么"。
   *  compose-report 节点产出,required — 老 prompt 体例的报告已全部清空,
   *  新生成必带 deck,不做"老报告无此字段"兜底(避免 null/undefined 兼容噪音)。 */
  @prop({ required: true, trim: true })
  deck!: string;

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
