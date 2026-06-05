import { createLowlight } from 'lowlight';
import { highlightLanguages } from './highlightLanguages';

type HastProperties = {
  className?: unknown;
};

type HastNode = {
  type?: string;
  tagName?: string;
  properties?: HastProperties;
  children?: HastNode[];
  value?: string;
};

const lowlight = createLowlight(highlightLanguages);

function nodeText(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return node.children?.map(nodeText).join('') ?? '';
}

function classNames(node: HastNode): string[] {
  const names = node.properties?.className;

  if (Array.isArray(names)) {
    return names.map(String);
  }

  if (typeof names === 'string') {
    return names.split(/\s+/).filter(Boolean);
  }

  return [];
}

function codeLanguage(node: HastNode): string | false | undefined {
  for (const name of classNames(node)) {
    if (name === 'no-highlight' || name === 'nohighlight') return false;
    if (name.startsWith('lang-')) return name.slice(5);
    if (name.startsWith('language-')) return name.slice(9);
  }

  return undefined;
}

function highlightCodeBlock(node: HastNode, parent?: HastNode): void {
  if (node.tagName !== 'code' || parent?.tagName !== 'pre') return;

  const language = codeLanguage(node);
  if (!language || !lowlight.registered(language)) return;

  const names = classNames(node);
  if (!names.includes('hljs')) {
    names.unshift('hljs');
  }

  node.properties = { ...node.properties, className: names };
  node.children = lowlight.highlight(language, nodeText(node)).children as HastNode[];
}

function visit(node: HastNode, parent?: HastNode): void {
  highlightCodeBlock(node, parent);

  for (const child of node.children ?? []) {
    visit(child, node);
  }
}

export function rehypeHighlightSubset() {
  return function transform(tree: HastNode): void {
    visit(tree);
  };
}
