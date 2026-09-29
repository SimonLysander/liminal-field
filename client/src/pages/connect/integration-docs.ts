type Parameter = { name: string; description: string; required?: boolean };

type ReadingTool = {
  id: string;
  name: string;
  title: string;
  path: string;
  summary: string;
  description: string;
  parameters: Parameter[];
  result: string;
  example: string;
  exampleArguments: Record<string, string>;
};

// This is a reading guide, not a second schema. The linked OpenAPI defines the contract.
export function readingTools(origin: string): ReadingTool[] {
  const base = `BASE='${origin}/api/v1/external'`;
  const cursor = { name: 'cursor', description: '使用上一页的 nextCursor；其他查询参数保持不变。' };
  const limit = { name: 'limit', description: '每页数量，默认 30，范围 1–100。' };
  return [
    {
      id: 'browse',
      name: 'browse_library',
      title: '浏览目录',
      path: '/browse',
      summary: '查看笔记、文集、画廊和简报的目录，以及各目录下的公开内容。',
      description: '返回当前目录的直接下级。省略 target 时返回笔记、文集、画廊和简报四个入口。',
      parameters: [
        {
          name: 'target',
          description:
            '入口名（notes / anthology / gallery / digest）、返回的 target 或本站公开页面 URL。',
        },
        cursor,
        limit,
      ],
      result: 'items 提供名称、target、页面 URL，以及是否有正文和下级目录；nextCursor 用于翻页。',
      exampleArguments: { target: 'notes' },
      example: `${base}\ncurl --fail-with-body --get "$BASE/browse" \\\n  --data-urlencode 'target=notes'`,
    },
    {
      id: 'search',
      name: 'search_content',
      title: '搜索内容',
      path: '/search',
      summary: '按关键词查找公开内容，并获取相关片段。',
      description: '按关键词搜索公开标题、摘要和正文。关键词按字面量匹配，不作为正则表达式。',
      parameters: [
        { name: 'query', required: true, description: '搜索关键词，1–200 个字符。' },
        {
          name: 'within',
          description:
            '入口名、返回的 target 或本站公开页面 URL；包含该项与全部下级。省略时搜索全部公开内容。',
        },
        cursor,
        limit,
      ],
      result: 'items 提供匹配内容及 snippet。snippet 只是匹配片段，完整正文需调用 read_content。',
      exampleArguments: { query: '相机', within: 'notes' },
      example: `${base}\ncurl --fail-with-body --get "$BASE/search" \\\n  --data-urlencode 'query=相机' \\\n  --data-urlencode 'within=notes'`,
    },
    {
      id: 'content',
      name: 'read_content',
      title: '读取正文',
      path: '/content',
      summary: '读取已发布的正文、章节目录和来源引用。',
      description: '读取公开正文，同时返回章节目录、来源引用和附件。Markdown、公式和代码保持原文。',
      parameters: [
        {
          name: 'target',
          required: true,
          description: '目录或搜索返回的 target，或本站公开页面 URL。',
        },
        {
          name: 'sectionRef',
          description: '使用本篇 sections 返回的 sectionRef；读取该节及其下级小节。',
        },
        cursor,
        {
          name: 'maxCharacters',
          description: '正文页字符数上限，默认 12000，范围 1000–60000。按 UTF-16 单元计数。',
        },
      ],
      result:
        'bodyMarkdown 是当前页正文；sections、assets、citations 是整篇元数据。nextCursor 不为空时继续读取；partialBlock=true 表示本页截取了一个超长块。只有下级公开、自身没有公开正文的目录返回 bodyMarkdown=null。',
      exampleArguments: { target: '返回的 target' },
      example: `${base}\n# 将下面的值替换为目录或搜索结果中的 target\nTARGET='返回的 target'\ncurl --fail-with-body --get "$BASE/content" \\\n  --data-urlencode "target=$TARGET"`,
    },
    {
      id: 'assets',
      name: 'read_asset',
      title: '读取附件',
      path: '/assets',
      summary: '获取正文引用的图片、音频、视频和文件。',
      description: '读取正文实际引用的图片、音频、视频或文件。不能读取未被公开正文引用的附件。',
      parameters: [
        {
          name: 'assetRef',
          required: true,
          description: '使用 read_content 返回的 assets[].assetRef，不能传任意文件名或地址。',
        },
        {
          name: 'representation',
          description:
            '以 representations 为准。图片仅提供 preview 缩略图；其他附件使用 original，文本文件还支持 text。省略时自动选择，空数组表示当前不可读取。',
        },
      ],
      result:
        '图片仅提供最长边不超过 896 像素的 WebP 缩略图，不提供原图。其他附件提供实际文件；text 不执行 OCR 或转录。预览不可用时不会改为下载原图，正文仍可读取。',
      exampleArguments: { assetRef: '返回的 assetRef' },
      example: `${base}\n# 将下面的值替换为 assets 中的 assetRef\nASSET_REF='返回的 assetRef'\ncurl --fail-with-body --get "$BASE/assets" \\\n  --data-urlencode "assetRef=$ASSET_REF" \\\n  --output attachment`,
    },
  ];
}

export const readingErrors = [
  {
    status: '400',
    code: 'INVALID_ARGUMENT / INVALID_REFERENCE',
    action: '核对参数，引用必须来自接口返回值；完整错误码见 OpenAPI。',
  },
  {
    status: '404',
    code: 'RESOURCE_NOT_FOUND',
    action: '内容不存在、已删除或未公开，不应尝试读取管理端。',
  },
  {
    status: '409',
    code: 'CONTENT_CHANGED',
    action: '公开版本已经变化。重新浏览或读取正文，获取新游标和引用。',
  },
  {
    status: '415',
    code: 'REPRESENTATION_UNAVAILABLE',
    action: '根据附件的 representations 选择可用形式。',
  },
  {
    status: '503',
    code: 'ASSET_READ_FAILED / ASSET_NOT_ARCHIVED',
    action: '附件暂不可读。保留错误信息，稍后再试。',
  },
  { status: '500', code: 'INTERNAL_ERROR', action: '服务端异常。保留错误码以便排查。' },
] as const;
