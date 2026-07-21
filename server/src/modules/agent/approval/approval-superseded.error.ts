/** 目标已经被更新的审批取代；这是不可重试的业务终态，不是存储故障。 */
export class ApprovalSupersededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalSupersededError';
  }
}
