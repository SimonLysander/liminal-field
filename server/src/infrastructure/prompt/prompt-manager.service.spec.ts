/**
 * PromptManagerService 单元测试
 *
 * 用 jest.spyOn(fs, ...) mock fs 调用，不依赖真实文件系统。
 * 测试覆盖：
 *   1. 正常渲染单变量替换
 *   2. 多变量替换
 *   3. 找不到 prompt 抛 Error
 *   4. 变量未提供时保留原占位（不抛错）
 */
import * as fs from 'fs';
import { PromptManagerService } from './prompt-manager.service';

// mock fs，避免真实磁盘 IO
jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

function makeService(): PromptManagerService {
  const service = new PromptManagerService();
  return service;
}

describe('PromptManagerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // existsSync: prompts 目录存在
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const ps = p.toString();
      return ps.endsWith('prompts') || ps.includes('digest');
    });

    // readdirSync: 顶层返回 [{name:'digest', isDirectory:true, isFile:false}]
    //             digest 目录返回两个 .md 文件

    (mockedFs.readdirSync as jest.MockedFunction<any>).mockImplementation(
      (dir: string) => {
        if (dir.toString().endsWith('digest')) {
          return [
            {
              name: 'react-agent.md',
              isDirectory: () => false,
              isFile: () => true,
            },
            {
              name: 'compose-plan.md',
              isDirectory: () => false,
              isFile: () => true,
            },
            {
              name: 'compose-write-section.md',
              isDirectory: () => false,
              isFile: () => true,
            },
          ];
        }
        // prompts root
        return [
          {
            name: 'digest',
            isDirectory: () => true,
            isFile: () => false,
          },
        ];
      },
    );

    // readFileSync: 按文件名返回模板内容

    (mockedFs.readFileSync as jest.MockedFunction<any>).mockImplementation(
      (p: string) => {
        const ps = p.toString();
        if (ps.endsWith('react-agent.md')) {
          return '你是「{{topic_name}}」的研究员。\n关注：{{topic_prompt}}';
        }
        if (ps.endsWith('compose-plan.md')) {
          return '主编 {{topic_name}}。\n清单：{{findings_list}}';
        }
        return '';
      },
    );
  });

  // Case 1: 单变量替换
  it('render() — 单变量替换正常', () => {
    const service = makeService();
    service.onModuleInit();

    const result = service.render('digest/react-agent.md', {
      topic_name: 'AI 应用',
      topic_prompt: '关注 LLM 落地',
    });

    expect(result).toContain('你是「AI 应用」的研究员');
    expect(result).toContain('关注：关注 LLM 落地');
  });

  // Case 2: 多变量替换（compose-plan.md 有 2 个变量）
  it('render() — 多变量全部替换', () => {
    const service = makeService();
    service.onModuleInit();

    const result = service.render('digest/compose-plan.md', {
      topic_name: '全球科技周报',
      findings_list: '[#1] OpenAI 发布新模型',
    });

    expect(result).toContain('主编 全球科技周报');
    expect(result).toContain('清单：[#1] OpenAI 发布新模型');
  });

  // Case 3: 找不到 prompt 文件 → 抛 Error
  it('render() — prompt 不存在 → 抛 Error("prompt not found: ...")', () => {
    const service = makeService();
    service.onModuleInit();

    expect(() => service.render('digest/nonexistent.md', {})).toThrow(
      'prompt not found: digest/nonexistent.md',
    );
  });

  // Case 4: 变量未提供时保留原占位，不抛错
  it('render() — 变量缺失时保留 {{key}} 占位，不抛错', () => {
    const service = makeService();
    service.onModuleInit();

    // 只传 topic_name，不传 topic_prompt
    const result = service.render('digest/react-agent.md', {
      topic_name: 'AI',
    });

    expect(result).toContain('你是「AI」的研究员');
    // 未传的变量保留占位
    expect(result).toContain('{{topic_prompt}}');
  });

  // Case 5: listLoaded() 返回已缓存的 prompt 名列表
  it('listLoaded() — 返回已加载的 prompt name 列表', () => {
    const service = makeService();
    service.onModuleInit();

    const list = service.listLoaded();
    expect(list).toContain('digest/react-agent.md');
    expect(list).toContain('digest/compose-plan.md');
    expect(list).toContain('digest/compose-write-section.md');
    expect(list).toHaveLength(3);
  });

  // Case 6: prompts 目录不存在时 warn 不抛错，listLoaded 返回空
  it('onModuleInit() — prompts 目录不存在时不抛错，listLoaded 返回 []', () => {
    mockedFs.existsSync.mockReturnValue(false);
    const service = makeService();

    // 不应抛错
    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.listLoaded()).toHaveLength(0);
  });
});
