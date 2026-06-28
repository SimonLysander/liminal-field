import { IsString } from 'class-validator';

/** POST /agent/writes/:toolCallId/approve|reject 的请求体 */
export class WriteApprovalDto {
  /** 审批鉴权：只有同 sessionKey 的发起者才能裁决 */
  @IsString()
  sessionKey!: string;
}
