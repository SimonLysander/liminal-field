/**
 * ProcessedFeedItem — 工作流命中条目记录（去重 + 历史查询）。
 *
 * 每次工作流 commit 节点，将 react_agent 阶段通过 save_finding 入选的条目
 * 写入此集合，用于：
 *   1. 去重：同一事项内同一 itemGuid 不重复推送
 *   2. 历史回溯：get_recent_picks 工具查最近已推条目
 *
 * 字段设计严格按 §3.1：
 *   _id, topicId, sourceId, itemGuid, title, url, pickedAt, reportContentItemId
 *
 * 索引：
 *   (topicId, itemGuid) unique — 去重核心
 *   (topicId, pickedAt: -1)  — 历史查询倒序
 *
 * 业务 id 前缀 pfi_，与 ci_/stc_/src_ 风格统一。
 */
import { index, modelOptions, prop } from '@typegoose/typegoose';

@index({ topicId: 1, itemGuid: 1 }, { unique: true })
@index({ topicId: 1, pickedAt: -1 })
@modelOptions({
  schemaOptions: { collection: 'processed_feed_items' },
})
export class ProcessedFeedItem {
  /** pfi_xxx 业务 id */
  @prop({ required: true })
  _id!: string;

  /** 事项 ContentItem.id（ci_xxx） */
  @prop({ required: true, index: true })
  topicId!: string;

  /** 来源信息源 InfoSource._id（src_xxx） */
  @prop({ required: true })
  sourceId!: string;

  /** RSS item guid；唯一标识条目，与 topicId 联合去重 */
  @prop({ required: true })
  itemGuid!: string;

  @prop({ required: true })
  title!: string;

  @prop({ required: true })
  url!: string;

  /** 被 save_finding 命中的时间戳 */
  @prop({ required: true, type: () => Date })
  pickedAt!: Date;

  /** 命中入了哪份报告（NavigationNode / ContentItem.id），commit 节点回写 */
  @prop({ required: true })
  reportContentItemId!: string;
}
