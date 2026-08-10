// cspell:words ɵɵelement ɵɵrepeater ɵɵelementStart
import fs from 'node:fs';
import path from 'node:path';

/**
 * HTML elements that silently fall back to <view> in Lynx.
 * Key: HTML tag name. Value: suggested Lynx replacement (null = no equivalent).
 */
const HTML_ELEMENT_SUGGESTIONS: Record<string, string | null> = {
  // Container elements → <view>
  div: 'view',
  section: 'view',
  article: 'view',
  aside: 'view',
  header: 'view',
  footer: 'view',
  main: 'view',
  nav: 'view',
  figure: 'view',
  figcaption: 'view',
  details: 'view',
  summary: 'view',
  form: 'view',
  fieldset: 'view',
  button: 'view',
  // Text elements → <text>
  span: 'text',
  p: 'text',
  h1: 'text',
  h2: 'text',
  h3: 'text',
  h4: 'text',
  h5: 'text',
  h6: 'text',
  label: 'text',
  strong: 'text',
  em: 'text',
  b: 'text',
  i: 'text',
  small: 'text',
  pre: 'text',
  code: 'text',
  blockquote: 'text',
  legend: 'text',
  a: 'text',
  // Special mappings
  img: 'image',
  ul: 'list',
  ol: 'list',
  li: 'list-item',
  // Table elements → <view> (use flex/grid)
  table: 'view',
  thead: 'view',
  tbody: 'view',
  tfoot: 'view',
  tr: 'view',
  td: 'view',
  th: 'view',
  // No Lynx equivalent
  select: null,
  option: null,
  canvas: null,
  video: null,
  audio: null,
  iframe: null,
  br: null,
  hr: null,
};

/**
 * CSS properties that are not supported in Lynx, with helpful alternatives.
 * Only includes properties that web developers commonly use.
 */
const UNSUPPORTED_CSS: Record<string, string> = {
  float: 'use flex layout',
  clear: 'use flex layout',
  'text-transform': 'not supported in Lynx',
  outline: 'use border instead',
  'outline-width': 'use border instead',
  'outline-style': 'use border instead',
  'outline-color': 'use border instead',
  'outline-offset': 'use border instead',
  'list-style': 'not supported',
  'list-style-type': 'not supported',
  'list-style-position': 'not supported',
  'list-style-image': 'not supported',
  'table-layout': 'use flex/grid layout',
  'border-collapse': 'use flex/grid layout',
  'border-spacing': 'use flex/grid layout',
  'word-spacing': 'not supported',
  resize: 'not supported',
  content: '::before/::after not supported',
  'scroll-behavior': 'not supported',
  'object-fit': 'not supported for images',
  'object-position': 'not supported for images',
  'user-select': 'not supported',
  'will-change': 'not supported',
  'backdrop-filter': 'use filter instead',
  'text-justify': 'not supported',
  'counter-reset': 'CSS counters not supported',
  'counter-increment': 'CSS counters not supported',
  'writing-mode': 'use direction property',
  'text-orientation': 'not supported',
  'column-count': 'multi-column layout not supported',
  'column-width': 'multi-column layout not supported',
  'column-rule': 'multi-column layout not supported',
};

/**
 * Extracts all element tag names from Angular AOT-compiled JS.
 *
 * Handles three patterns:
 * - ɵɵelementStart(idx, "tag") / ɵɵelement(idx, "tag")
 * - Chained calls: ɵɵelementStart(0, "view", 1)(2, "list", 3)
 * - ɵɵrepeaterCreate insertion-point optimization (@for with single root element)
 */
const collectElementTags = (code: string): Set<string> => {
  const chainPattern = /ɵɵelement(?:Start)?\([^)]*\)(?:\([^)]*\))*/g;
  const tagExtractor = /\(\d+,\s*["']([a-z][a-z0-9-]*)["']/g;
  const repeaterPattern =
    /ɵɵrepeaterCreate\(\d+,\s*\w+,\s*\d+,\s*\d+,\s*["']([a-z][a-z0-9-]*)["']/g;

  const tags = new Set<string>();
  let match: RegExpExecArray | null;
  let tagMatch: RegExpExecArray | null;

  for (const chain of code.matchAll(chainPattern)) {
    tagExtractor.lastIndex = 0;
    while ((tagMatch = tagExtractor.exec(chain[0])) !== null) {
      tags.add(tagMatch[1]!);
    }
  }
  while ((match = repeaterPattern.exec(code)) !== null) {
    tags.add(match[1]!);
  }

  return tags;
};

export type LynxDiagnosticCategory = 'html-element' | 'structural' | 'css';

export type LynxDiagnostic = {
  file: string;
  message: string;
  category: LynxDiagnosticCategory;
};

/**
 * Scans Angular AOT-compiled output for HTML elements used in templates.
 *
 * Angular's compiler emits ɵɵelementStart(idx, "tag") and ɵɵelement(idx, "tag")
 * for every template element. We regex-match these to detect HTML element usage
 * that will silently fall back to <view> at runtime.
 */
export const scanCompiledOutputForHtmlElements = (
  fileCache: Map<string, string | Uint8Array>,
): LynxDiagnostic[] => {
  const diagnostics: LynxDiagnostic[] = [];

  for (const [file, contents] of fileCache) {
    if (file.includes('node_modules')) continue;

    const code =
      typeof contents === 'string'
        ? contents
        : Buffer.from(contents).toString();

    const tags = collectElementTags(code);
    const fileName = path.relative(process.cwd(), file);

    for (const tag of tags) {
      if (!(tag in HTML_ELEMENT_SUGGESTIONS)) continue;

      const replacement = HTML_ELEMENT_SUGGESTIONS[tag];
      const message =
        replacement !== null
          ? `${fileName}: <${tag}> is not a Lynx element. Use <${replacement}> instead.`
          : `${fileName}: <${tag}> has no Lynx equivalent and will not render correctly.`;

      diagnostics.push({ file, message, category: 'html-element' });
    }
  }

  return diagnostics;
};

/**
 * Scans component source files for patterns that are unsupported in Lynx:
 * - ViewEncapsulation.ShadowDom (silently falls back to None)
 */
export const scanSourcesForUnsupportedPatterns = (
  fileNames: readonly string[],
): LynxDiagnostic[] => {
  const diagnostics: LynxDiagnostic[] = [];

  for (const filePath of fileNames) {
    if (filePath.includes('node_modules')) continue;

    let source: string;
    try {
      source = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    if (source.includes('ViewEncapsulation.ShadowDom')) {
      const fileName = path.relative(process.cwd(), filePath);
      diagnostics.push({
        file: filePath,
        message: `${fileName}: ViewEncapsulation.ShadowDom is not supported in Lynx (falls back to None). Use Emulated instead.`,
        category: 'structural',
      });
    }
  }

  return diagnostics;
};

/**
 * Scans the AOT compiled output for structural issues:
 * - <list-item> used without a <list> parent in the same component
 *
 * Uses the same ɵɵelementStart/ɵɵelement pattern as HTML element detection
 * to identify element usage in compiled templates.
 */
export const scanCompiledOutputForStructuralIssues = (
  fileCache: Map<string, string | Uint8Array>,
): LynxDiagnostic[] => {
  const diagnostics: LynxDiagnostic[] = [];

  for (const [file, contents] of fileCache) {
    if (file.includes('node_modules')) continue;

    const code =
      typeof contents === 'string'
        ? contents
        : Buffer.from(contents).toString();

    const tags = collectElementTags(code);

    const fileName = path.relative(process.cwd(), file);

    // <list-item> without <list> in the same component
    if (tags.has('list-item') && !tags.has('list')) {
      diagnostics.push({
        file,
        message: `${fileName}: <list-item> used without a <list> parent. Wrap list items in a <list> element.`,
        category: 'structural',
      });
    }
  }

  return diagnostics;
};

/**
 * Scans component source files for CSS properties not supported in Lynx.
 *
 * Extracts inline styles from @Component decorators and resolves external
 * styleUrls, then checks each property declaration against the unsupported list.
 */
export const scanSourcesForUnsupportedCss = (
  fileNames: readonly string[],
): LynxDiagnostic[] => {
  const diagnostics: LynxDiagnostic[] = [];

  for (const filePath of fileNames) {
    if (filePath.includes('node_modules')) continue;

    let source: string;
    try {
      source = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    if (!source.includes('@Component')) continue;

    // Collect all CSS from this component (inline styles + external styleUrls)
    const cssChunks: string[] = [];

    // Extract inline styles: `styles: [\`...\`]`
    const stylesBlockMatch = source.match(/styles\s*:\s*\[([\s\S]*?)\]/);
    if (stylesBlockMatch) {
      for (const m of stylesBlockMatch[1].matchAll(/`([\s\S]*?)`/g)) {
        cssChunks.push(m[1]);
      }
      // Also try quoted strings if no backtick styles found
      if (cssChunks.length === 0) {
        for (const m of stylesBlockMatch[1].matchAll(/(['"])([\s\S]*?)\1/g)) {
          cssChunks.push(m[2]);
        }
      }
    }

    // Resolve external styleUrls
    const styleUrlsMatch = source.match(/styleUrls?\s*:\s*\[([\s\S]*?)\]/);
    if (styleUrlsMatch) {
      for (const m of styleUrlsMatch[1].matchAll(/['"]([^'"]+)['"]/g)) {
        const stylePath = path.resolve(path.dirname(filePath), m[1]);
        try {
          cssChunks.push(fs.readFileSync(stylePath, 'utf-8'));
        } catch {
          // External stylesheet may not exist yet
        }
      }
    }

    // Scan for unsupported CSS properties
    const seen = new Set<string>();
    const fileName = path.relative(process.cwd(), filePath);

    for (const css of cssChunks) {
      // Strip CSS comments before scanning
      const withoutComments = css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '');

      // Match CSS property declarations
      const propertyPattern = /(?:^|[{;])\s*([a-z-]+)\s*:/gm;
      let match: RegExpExecArray | null;
      while ((match = propertyPattern.exec(withoutComments)) !== null) {
        const property = match[1];
        if (UNSUPPORTED_CSS[property] && !seen.has(property)) {
          seen.add(property);
          diagnostics.push({
            file: filePath,
            message: `${fileName}: '${property}' — ${UNSUPPORTED_CSS[property]}.`,
            category: 'css',
          });
        }
      }
    }
  }

  return diagnostics;
};

/**
 * Logs Lynx-specific diagnostics to the console, grouped by category.
 */
export const reportLynxDiagnostics = (diagnostics: LynxDiagnostic[]): void => {
  if (diagnostics.length === 0) return;

  const htmlWarnings = diagnostics.filter((d) => d.category === 'html-element');
  const structuralWarnings = diagnostics.filter(
    (d) => d.category === 'structural',
  );
  const cssWarnings = diagnostics.filter((d) => d.category === 'css');

  if (htmlWarnings.length > 0) {
    console.warn('[Lynx] HTML elements detected in templates:');
    for (const w of htmlWarnings) {
      console.warn(`  ${w.message}`);
    }
  }

  if (structuralWarnings.length > 0) {
    console.warn('[Lynx] Structural issues:');
    for (const w of structuralWarnings) {
      console.warn(`  ${w.message}`);
    }
  }

  if (cssWarnings.length > 0) {
    console.warn('[Lynx] Unsupported CSS properties:');
    for (const w of cssWarnings) {
      console.warn(`  ${w.message}`);
    }
  }
};
