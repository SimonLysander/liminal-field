import { createHash } from 'crypto';

/**
 * computeBodyHash — Aurora 改稿协议的内容指纹。
 *
 * 用 sha256 算正文 markdown 的指纹,截前 16 字符(64bit hex)。
 * 用途:
 *   - get_current_draft 返回 bodyHash 给模型
 *   - propose_document_rewrite 接收 baseHash 做强校验,不符返回 status:stale
 *
 * 截断 16 字符碰撞概率 ~5e-10,可忽略;短便于模型 round-trip(节省 token)。
 * 不持久化:每次调用即时算,μs 级。
 */
export function computeBodyHash(bodyMarkdown: string): string {
  return createHash('sha256')
    .update(bodyMarkdown, 'utf8')
    .digest('hex')
    .slice(0, 16);
}
