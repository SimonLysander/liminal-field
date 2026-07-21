import { dump, load } from 'js-yaml';
import { z } from 'zod';

const learnPlanItemSchema = z.object({
  title: z.string().trim().min(1),
  thread: z.string().trim().min(1),
  why: z.string().trim().min(1),
});

const learnPlanFrontmatterSchema = z.object({
  goal: z.string().trim().min(1),
  items: z.array(learnPlanItemSchema).min(1),
  conclusion: z.string().default(''),
});

export interface LearnPlanItem {
  title: string;
  thread: string;
  why: string;
}

export interface LearnPlanDocument {
  goal: string;
  understanding: string;
  items: LearnPlanItem[];
  conclusion: string;
}

/**
 * 学习规划的持久化编码边界。YAML 只属于服务端存储协议，不暴露给客户端。
 */
export function serializeLearnPlanDocument(
  document: LearnPlanDocument,
): string {
  const yaml = dump(
    {
      goal: document.goal,
      items: document.items,
      conclusion: document.conclusion,
    },
    { lineWidth: -1 },
  ).trimEnd();

  return `---\n${yaml}\n---\n\n${document.understanding}`;
}

/**
 * 将服务端存储的规划文档解析为稳定 DTO。损坏数据必须显式失败，不能伪装成“尚无规划”。
 */
export function parseLearnPlanDocument(
  bodyMarkdown: string,
): LearnPlanDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/.exec(bodyMarkdown);
  if (!match) {
    throw new Error('学习规划文档格式无效：缺少 YAML frontmatter');
  }

  try {
    const frontmatter = learnPlanFrontmatterSchema.parse(load(match[1]));
    const understanding = bodyMarkdown
      .slice(match[0].length)
      .replace(/^(?:\r?\n)+/, '')
      .trim();
    if (!understanding) {
      throw new Error('understanding 不能为空');
    }

    return { ...frontmatter, understanding };
  } catch (error) {
    // 解析器错误可能附带 YAML 内容片段；对外和日志都只暴露稳定错误类别。
    throw new Error('学习规划文档格式无效', { cause: error });
  }
}
