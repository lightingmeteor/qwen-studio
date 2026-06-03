import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

function CodeBlock({ children }: { children?: ReactNode }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const code = extractText(children);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative group my-2">
      <button
        onClick={copy}
        className="absolute right-2 top-2 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 opacity-0 group-hover:opacity-100 transition"
      >
        {copied ? '已复制' : '复制'}
      </button>
      <pre className="overflow-x-auto rounded-lg bg-[#0b0d12] p-3 text-sm">{children}</pre>
    </div>
  );
}

export default function MarkdownMessage({ content }: { content: string }): JSX.Element {
  return (
    <div className="prose-invert max-w-none leading-relaxed [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:border-white/15 [&_th]:border-white/15 [&_td]:px-2 [&_th]:px-2 [&_a]:text-sky-400 [&_code]:rounded [&_:not(pre)>code]:bg-white/10 [&_:not(pre)>code]:px-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{ pre: ({ children }) => <CodeBlock>{children}</CodeBlock> }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
