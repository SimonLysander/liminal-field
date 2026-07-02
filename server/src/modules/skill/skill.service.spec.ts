/**
 * SkillService 单测 — CRUD 主路径 + 重名/404 异常路径。
 *
 * 与项目内 *.service.spec.ts 风格对齐:直接 new SkillService + cast mock,不上 Test.createTestingModule
 * (CRUD service 没有装配复杂度,DI 模拟反而冗余)。
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SkillService } from './skill.service';
import type { SkillRepository } from './skill.repository';

function createMocks() {
  const mockRepo: jest.Mocked<SkillRepository> = {
    findAll: jest.fn(),
    findById: jest.fn(),
    findByName: jest.fn(),
    findByIds: jest.fn(),
    create: jest.fn(),
    updateById: jest.fn(),
    deleteById: jest.fn(),
  } as unknown as jest.Mocked<SkillRepository>;

  const mockEventBus = {
    emit: jest.fn(),
  } as unknown as jest.Mocked<EventEmitter2>;

  // 内置 skill body 从文件渲染;mock 回固定串即可(本 spec 测的是用户 skill 的 CRUD)
  const mockPromptManager = {
    render: jest.fn().mockReturnValue('# builtin body'),
  } as unknown as import('../../infrastructure/prompt/prompt-manager.service').PromptManagerService;

  const service = new SkillService(mockRepo, mockEventBus, mockPromptManager);

  return { service, mockRepo, mockEventBus };
}

describe('SkillService', () => {
  describe('create', () => {
    it('name 重名 → 抛 ConflictException(409)', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.findByName.mockResolvedValue({ name: 'critic' } as never);

      await expect(
        service.create({
          name: 'critic',
          displayName: '批评家',
          description: 'x',
          whenToUse: 'x',
          body: 'x',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('name 不重复 → 正常创建', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.findByName.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue({ _id: 'a1', name: 'critic' } as never);

      const result = await service.create({
        name: 'critic',
        displayName: '批评家',
        description: 'x',
        whenToUse: 'x',
        body: 'x',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'critic' }),
      );
      expect(result).toEqual(expect.objectContaining({ _id: 'a1' }));
    });
  });

  describe('update', () => {
    it('找不到 skill → 抛 NotFoundException(404)', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.updateById.mockResolvedValue(null);

      await expect(
        service.update('nope', { description: 'new' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('改 name 时撞别的 skill → 抛 ConflictException', async () => {
      const { service, mockRepo } = createMocks();
      // 别的 skill 已用 'polish'(id 不同)
      mockRepo.findByName.mockResolvedValue({
        _id: 'other-id',
        name: 'polish',
      } as never);

      await expect(
        service.update('this-id', { name: 'polish' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('改 name 时撞自己的 name → 通过(同 id)', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.findByName.mockResolvedValue({
        _id: 'this-id',
        name: 'polish',
      } as never);
      mockRepo.updateById.mockResolvedValue({
        _id: 'this-id',
        name: 'polish',
      } as never);

      await expect(
        service.update('this-id', { name: 'polish' }),
      ).resolves.toBeDefined();
    });
  });

  describe('delete', () => {
    it('找不到 skill → 不抛(幂等)', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.deleteById.mockResolvedValue(undefined);

      await expect(service.delete('any')).resolves.toBeUndefined();
    });

    it('删除后发 skill.deleted 事件(级联清理 agent.enabledSkillIds 在 Task 0.6 接)', async () => {
      const { service, mockRepo, mockEventBus } = createMocks();
      mockRepo.deleteById.mockResolvedValue(undefined);

      await service.delete('sk1');

      expect(mockEventBus.emit).toHaveBeenCalledWith('skill.deleted', {
        skillId: 'sk1',
      });
    });
  });

  // 内置 skill 文件优先解析、Mongo 回落（提示词集中管理 Phase 3）
  describe('内置 skill 合并解析', () => {
    it('findByName 命中内置 key → 返回文件 body,不查 Mongo', async () => {
      const { service, mockRepo } = createMocks();
      const s = await service.findByName('note-writing');
      expect(s?.name).toBe('note-writing');
      expect(s?.body).toBe('# builtin body'); // 来自 mock render
      expect(s?.requiredTools).toContain('read_content');
      expect(mockRepo.findByName).not.toHaveBeenCalled();
    });

    it('findByName 非内置 → 落 Mongo', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.findByName.mockResolvedValue(null);
      await service.findByName('critic');
      expect(mockRepo.findByName).toHaveBeenCalledWith('critic');
    });

    it('findByIds 混合 key 与 ObjectId → 内置走文件、其余走 Mongo', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.findByIds.mockResolvedValue([
        { _id: 'oid1', name: 'critic' },
      ] as never);
      const got = await service.findByIds(['note-writing', 'oid1']);
      expect(got.map((s) => s.name)).toEqual(['note-writing', 'critic']);
      expect(mockRepo.findByIds).toHaveBeenCalledWith(['oid1']); // 内置 key 不进 Mongo 查询
    });

    it('writing-review 不绑定普通编辑器专属工具', async () => {
      const { service } = createMocks();
      const s = await service.findByName('writing-review');
      expect(s?.requiredTools).toEqual([]);
    });

    it('list 含内置且排除 Mongo 同名残留', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.findAll.mockResolvedValue([
        { _id: 'x', name: 'note-writing' }, // 老库 seed 残留,应被内置盖掉
        { _id: 'y', name: 'critic' },
      ] as never);
      const names = (await service.list()).map((s) => s.name);
      expect(names).toContain('note-plan');
      expect(names.filter((n) => n === 'note-writing')).toHaveLength(1);
      expect(names).toContain('writing-review');
      expect(names).toContain('critic');
    });
  });
});
