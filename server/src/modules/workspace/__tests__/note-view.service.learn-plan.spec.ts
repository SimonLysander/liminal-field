import { InternalServerErrorException } from '@nestjs/common';
import { NoteViewService } from '../note-view.service';
import { serializeLearnPlanDocument } from '../learn-plan-document';

function createService(bodyMarkdown: string | null) {
  const contentService = {
    assertContentItemExists: jest.fn().mockResolvedValue(undefined),
  };
  const editorDraftRepository = {
    findAiDraftByContentItemId: jest.fn().mockResolvedValue(
      bodyMarkdown == null
        ? null
        : {
            bodyMarkdown,
          },
    ),
  };
  const service = new NoteViewService(
    contentService as never,
    {} as never,
    {} as never,
    editorDraftRepository as never,
    {} as never,
    {} as never,
  );

  return { contentService, editorDraftRepository, service };
}

describe('NoteViewService.getLearnPlan', () => {
  it('没有 AI 规划草稿时返回 null', async () => {
    const { contentService, service } = createService(null);

    await expect(service.getLearnPlan('ci_topic')).resolves.toBeNull();
    expect(contentService.assertContentItemExists).toHaveBeenCalledWith(
      'ci_topic',
    );
  });

  it('将服务端存储文档解析为结构化规划 DTO', async () => {
    const document = {
      goal: '建立完整认识',
      understanding: '第一段。\n\n第二段。\n\n第三段。',
      items: [{ title: '基础', thread: '起点', why: '建立基础。' }],
      conclusion: '回到实践。',
    };
    const { service } = createService(serializeLearnPlanDocument(document));

    await expect(service.getLearnPlan('ci_topic')).resolves.toEqual(document);
  });

  it('规划文档损坏时抛出 500，不伪装成“没有规划”', async () => {
    const { service } = createService('不是学习规划文档');

    await expect(service.getLearnPlan('ci_topic')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
