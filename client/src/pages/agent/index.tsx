/**
 * AgentPage — Lux 全页总助手。
 *
 * 直接接入编辑器侧栏的 AiAdvisorPanel(已能用的对话),全局会话、不绑文档。
 * 页面布局/设计后续由设计侧处理,这里只负责把功能接进来。
 */
import { AiAdvisorPanel } from '@/components/ai-advisor/AiAdvisorPanel';

export default function AgentPage() {
  return (
    // 让 AiAdvisorPanel 根 div 撑满页面区域(不改其内部结构)
    <div className="flex flex-1 flex-col overflow-hidden [&>div]:min-h-0 [&>div]:flex-1">
      <AiAdvisorPanel sessionKey="agent-page" />
    </div>
  );
}
