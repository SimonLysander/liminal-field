import { CodeCopyButton } from '@/components/shared/CodeCopyButton';
import { MarkdownTocPanel, type TocEntry } from '@/components/shared/MarkdownTocPanel';
import { getHttpConnectionInstructions } from '@/services/external-read';
import { Tab, TabList, TabPanel, TabProvider } from '@ariakit/react';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { readingErrors, readingTools } from './integration-docs';

const sections = [
  { id: 'http', text: '接入方式', level: 1 },
  { id: 'tools', text: '可读取的内容', level: 1 },
  { id: 'reading', text: '使用范围', level: 1 },
  { id: 'reference', text: '技术说明', level: 1 },
] satisfies TocEntry[];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2
        id={id}
        data-heading-id={id}
        className="mb-3 font-serif text-2xl font-bold text-[var(--ink)]"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function ReferenceSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-6">
      <h3 id={id} data-heading-id={id} className="font-serif text-xl font-bold text-[var(--ink)]">
        {title}
      </h3>
      <div className="mt-3 space-y-4 text-md">{children}</div>
    </section>
  );
}

function Address({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="grid min-w-0 gap-1 py-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4">
      <dt className="self-center font-sans text-sm text-[var(--ink-faded)]">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label="查看接口说明（OpenAPI）"
            className="flex min-w-0 flex-1 items-center gap-1 text-[var(--ink-light)] hover:text-[var(--ink)]"
          >
            <code className="min-w-0 break-all font-mono text-sm leading-5">{value}</code>
            <ArrowUpRight size={12} className="shrink-0" aria-hidden="true" />
          </a>
        ) : (
          <code className="min-w-0 flex-1 break-all font-mono text-sm leading-5 text-[var(--ink-light)]">
            {value}
          </code>
        )}
        <CodeCopyButton
          value={value}
          copyAriaLabel={`复制${label}`}
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-[var(--ink-faded)]"
        />
      </dd>
    </div>
  );
}

function CodeSample({ title, code }: { title: string; code: string }) {
  return (
    <div className="relative min-w-0 rounded-md bg-muted">
      <CodeCopyButton
        value={code}
        copyAriaLabel={`复制${title}`}
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1 size-7 text-[var(--ink-faded)]"
      />
      <pre
        aria-label={title}
        className="overflow-x-auto p-4 pr-10 font-mono text-sm leading-6 text-[var(--ink-light)]"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function HttpConnectionInstructions() {
  const [result, setResult] = useState<
    { status: 'loading' } | { status: 'ready'; instructions: string } | { status: 'error' }
  >({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void getHttpConnectionInstructions(controller.signal).then(
      (instructions) => {
        if (!controller.signal.aborted) setResult({ status: 'ready', instructions });
      },
      () => {
        if (!controller.signal.aborted) setResult({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, []);

  return (
    <div className="mt-4">
      <CodeCopyButton
        value={result.status === 'ready' ? result.instructions : ''}
        disabled={result.status !== 'ready'}
        copyAriaLabel="复制 HTTP 接入说明"
        variant="outline"
        className="h-8 font-sans text-base"
      >
        复制 HTTP 接入说明
      </CodeCopyButton>
      {result.status === 'loading' && (
        <p role="status" className="mt-2 font-sans text-sm text-[var(--ink-faded)]">
          正在获取接入说明…
        </p>
      )}
      {result.status === 'error' && (
        <p role="alert" className="mt-2 font-sans text-sm text-[var(--ink-faded)]">
          接入说明暂时无法获取，可直接使用上方接口说明地址。
        </p>
      )}
      {result.status === 'ready' && (
        <pre
          aria-label="HTTP 接入说明"
          className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[var(--ink-faded)]"
        >
          {result.instructions}
        </pre>
      )}
    </div>
  );
}

export default function ConnectPage() {
  const centerRef = useRef<HTMLDivElement>(null);
  const [method, setMethod] = useState<'mcp' | 'http'>('mcp');
  const origin = window.location.origin;
  const baseUrl = `${origin}/api/v1/external`;
  const openApiUrl = `${baseUrl}/openapi.json`;
  const tools = readingTools(origin);
  const toc: TocEntry[] = [
    ...sections,
    ...tools.map((tool) => ({ id: `reference-${tool.id}`, text: tool.title, level: 2 })),
    { id: 'reference-pagination', text: '读取顺序与分页', level: 2 },
    { id: 'reference-errors', text: '响应与错误处理', level: 2 },
  ];

  return (
    <div className="relative flex min-w-0 flex-1 items-stretch overflow-hidden">
      <div ref={centerRef} className="min-w-0 flex-1 overflow-y-auto py-12">
        <article
          className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 text-lg leading-[1.75] text-[var(--ink-light)] max-[520px]:px-4"
          style={{ fontFamily: 'var(--font-reading)', letterSpacing: 0 }}
        >
          <header className="mb-8">
            <h1 className="font-serif text-5xl font-bold leading-snug text-[var(--ink)]">
              接入说明
            </h1>
            <p className="mt-2 font-sans text-xs text-[var(--ink-faded)]">
              公开内容 · 只读 · 无需登录
            </p>
            <p className="mt-6">浏览和读取本站公开的笔记、文集、画廊与简报。</p>
          </header>

          <Section id="http" title="接入方式">
            <TabProvider
              selectedId={`connect-${method}`}
              setSelectedId={(id) => {
                if (id === 'connect-mcp' || id === 'connect-http') {
                  setMethod(id === 'connect-http' ? 'http' : 'mcp');
                }
              }}
            >
              <TabList
                aria-label="接入方式"
                className="flex gap-4 border-b border-[var(--separator)] font-sans text-base"
              >
                <Tab
                  id="connect-mcp"
                  className="h-10 min-w-20 border-b-2 border-transparent px-3 text-[var(--ink-faded)] hover:text-[var(--ink)] aria-selected:border-[var(--ink)] aria-selected:font-medium aria-selected:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  MCP
                </Tab>
                <Tab
                  id="connect-http"
                  className="h-10 min-w-20 border-b-2 border-transparent px-3 text-[var(--ink-faded)] hover:text-[var(--ink)] aria-selected:border-[var(--ink)] aria-selected:font-medium aria-selected:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  HTTP
                </Tab>
              </TabList>
              <TabPanel
                tabId="connect-mcp"
                className="pt-4 focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                <p>在支持 MCP 的工具中添加连接，填写下方地址，身份验证选择「无」。</p>
                <dl className="my-3">
                  <Address label="MCP 地址" value={`${baseUrl}/mcp`} />
                  <div className="grid gap-1 py-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4">
                    <dt className="self-center font-sans text-sm text-[var(--ink-faded)]">
                      传输类型
                    </dt>
                    <dd className="font-sans text-base">Streamable HTTP</dd>
                  </div>
                </dl>
                <p className="font-sans text-sm text-[var(--ink-faded)]">无需登录或密钥。</p>
              </TabPanel>
              <TabPanel
                tabId="connect-http"
                className="pt-4 focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                <p>支持导入 OpenAPI 的工具可使用接口说明地址；直接发送请求时，使用接口地址。</p>
                <dl className="my-3">
                  <Address label="接口说明" value={openApiUrl} href={openApiUrl} />
                  <Address label="接口地址" value={baseUrl} />
                </dl>
                <p className="font-sans text-sm text-[var(--ink-faded)]">无需登录或密钥。</p>
                {method === 'http' && <HttpConnectionInstructions />}
              </TabPanel>
            </TabProvider>
          </Section>

          <Section id="tools" title="可读取的内容">
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {tools.map((tool) => (
                <section key={tool.id} aria-labelledby={`tool-${tool.id}`}>
                  <h3 id={`tool-${tool.id}`} className="text-xl font-bold text-[var(--ink)]">
                    {tool.title}
                  </h3>
                  <p className="mt-1">{tool.summary}</p>
                </section>
              ))}
            </div>
          </Section>

          <Section id="reading" title="使用范围">
            <div className="space-y-3">
              <p>
                仅提供访客可见的内容，以当前已发布的版本为准。草稿、未公开内容和历史版本不在读取范围内。
              </p>
              <p>此接入仅用于读取，不会修改、移动、删除或发布内容。</p>
              <p>
                图片只提供缩略图，不提供原图。MCP
                可直接返回图片预览和文本，其他附件提供文件链接。图片、音频、视频和 PDF
                能否被理解，取决于所用工具；本站不额外生成图片描述、文字识别结果或音视频转录。
              </p>
            </div>
          </Section>

          <Section id="reference" title="技术说明">
            {tools.map((tool) => (
              <ReferenceSection key={tool.id} id={`reference-${tool.id}`} title={tool.title}>
                <code className="block break-all font-mono text-sm text-[var(--ink-faded)]">
                  {tool.name}
                </code>
                <p>{tool.description}</p>
                <table className="w-full table-fixed text-left font-sans text-base">
                  <caption className="sr-only">{tool.title}参数</caption>
                  <colgroup>
                    <col className="w-32 sm:w-40" />
                    <col />
                  </colgroup>
                  <thead className="border-b border-[var(--separator)] text-sm text-[var(--ink-faded)]">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-normal">
                        参数
                      </th>
                      <th scope="col" className="py-2 font-normal">
                        说明
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tool.parameters.map((parameter) => (
                      <tr
                        key={parameter.name}
                        className="border-b border-[var(--separator)] last:border-0"
                      >
                        <th
                          scope="row"
                          className="break-all py-3 pr-3 align-top font-mono text-sm font-normal text-[var(--ink)]"
                        >
                          {parameter.name}
                          <span className="mt-1 block font-sans text-xs text-[var(--ink-faded)]">
                            {parameter.required ? '必填' : '可选'}
                          </span>
                        </th>
                        <td className="break-words py-3 align-top">{parameter.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  <span className="text-[var(--ink)]">返回内容：</span>
                  {tool.result}
                </p>
                <p className="font-sans text-sm text-[var(--ink-faded)]">
                  {method === 'mcp'
                    ? 'MCP 调用参数 · tools/call'
                    : `HTTP 请求示例 · GET ${tool.path}`}
                </p>
                <CodeSample
                  key={method}
                  title={`${tool.title}示例`}
                  code={
                    method === 'mcp'
                      ? JSON.stringify(
                          { name: tool.name, arguments: tool.exampleArguments },
                          null,
                          2,
                        )
                      : tool.example
                  }
                />
              </ReferenceSection>
            ))}
            <ReferenceSection id="reference-pagination" title="读取顺序与分页">
              <p className="mb-4">
                先浏览目录或搜索，取得 <code className="font-mono text-sm">target</code>{' '}
                后读取正文；需要附件时，使用正文返回的{' '}
                <code className="font-mono text-sm">assetRef</code>。
                {method === 'mcp' ? 'MCP 通过同名工具调用读取内容。' : 'HTTP 读取接口均使用 GET。'}
              </p>
              <dl className="space-y-4">
                <div>
                  <dt className="font-bold text-[var(--ink)]">分页和章节</dt>
                  <dd className="mt-1">
                    持续使用 <code className="font-mono text-sm">nextCursor</code>，直到其为{' '}
                    <code className="font-mono text-sm">null</code>。正文分页时保持相同{' '}
                    <code className="font-mono text-sm">target</code> 和{' '}
                    <code className="font-mono text-sm">sectionRef</code>
                    。章节包含下级小节；章节目录、附件和引用始终属于整篇。
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-[var(--ink)]">引用标识</dt>
                  <dd className="mt-1">
                    <code className="font-mono text-sm">cursor</code>、
                    <code className="font-mono text-sm">sectionRef</code> 和{' '}
                    <code className="font-mono text-sm">assetRef</code>{' '}
                    应直接使用返回值，不自行拼接。引用绑定公开版本，版本变化后应重新获取。
                  </dd>
                </div>
              </dl>
            </ReferenceSection>
            <ReferenceSection id="reference-errors" title="响应与错误处理">
              {method === 'http' ? (
                <p>
                  HTTP 目录、搜索和正文成功返回 <code className="font-mono text-sm">code=0</code>、
                  <code className="font-mono text-sm">msg="ok"</code>，结果位于{' '}
                  <code className="font-mono text-sm">data</code>。错误同时提供 HTTP 状态和{' '}
                  <code className="font-mono text-sm">error.code</code>
                  ；附件成功时直接返回文件，失败时仍返回 JSON 错误。
                </p>
              ) : (
                <p>
                  MCP 目录、搜索和正文结果位于{' '}
                  <code className="font-mono text-sm">structuredContent</code>，
                  同时提供文本结果。工具执行失败返回{' '}
                  <code className="font-mono text-sm">isError=true</code> 和公开错误码；协议错误使用
                  JSON-RPC 错误响应。附件内联返回不超过 4 MiB 的 WebP 缩略图或 UTF-8
                  文本，其他文件提供 <code className="font-mono text-sm">resource_link</code>。
                </p>
              )}
              <dl className="mt-4 space-y-4">
                {readingErrors.map((error) => (
                  <div
                    key={error.status}
                    className={method === 'http' ? 'grid grid-cols-[32px_minmax(0,1fr)] gap-3' : ''}
                  >
                    <dt className="min-w-0 font-mono text-sm text-[var(--ink-faded)]">
                      {method === 'http' ? (
                        error.status
                      ) : (
                        <code className="block break-all font-mono text-xs">{error.code}</code>
                      )}
                    </dt>
                    <dd className="min-w-0">
                      {method === 'http' && (
                        <code className="block break-all font-mono text-xs text-[var(--ink-faded)]">
                          {error.code}
                        </code>
                      )}
                      <p className="mt-1 text-md">{error.action}</p>
                    </dd>
                  </div>
                ))}
              </dl>
            </ReferenceSection>
          </Section>
        </article>
      </div>
      <MarkdownTocPanel toc={toc} centerRef={centerRef} />
    </div>
  );
}
