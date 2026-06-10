import type { LanguageFn } from 'highlight.js';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import diff from 'highlight.js/lib/languages/diff';

// Curated subset: chat clients rarely need every bundled grammar.
// `xml` covers HTML; `bash`/`shell` cover terminal snippets.
export const highlightLanguages: Record<string, LanguageFn> = {
  javascript,
  typescript,
  python,
  json,
  bash,
  shell,
  xml,
  css,
  sql,
  go,
  rust,
  java,
  c,
  cpp,
  markdown,
  yaml,
  diff,
};
