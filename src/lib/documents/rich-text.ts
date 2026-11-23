// Customer-facing document rendering and internal-note guards.
//
// Approved legal sources may legitimately use a simple Markdown subset:
// `#` title, `##` section heading, `>` metadata, `-` bullets, blank lines
// between paragraphs, and `**bold**` inline. The stored content remains the
// source of truth; renderers must never show the internal markers.

export type DocumentBlockType = 'title' | 'heading' | 'paragraph' | 'metadata' | 'bullet';

export interface DocumentBlock {
  type: DocumentBlockType;
  text: string;
}

const INTERNAL_NOTICE_PATTERNS: RegExp[] = [
  /owner review draft/i,
  /not effective until approved/i,
  /review[- ]only/i,
  /internal draft/i,
  /draft for owner/i,
  /customer[- ]facing copy pending/i,
];

function normalize(content: string): string {
  return String(content ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function lineIsInternalNotice(line: string): boolean {
  const trimmed = line.trim().replace(/^\*\*Status:\*\*\s*/i, 'Status: ');
  if (!trimmed || trimmed.length > 220) return false;
  return INTERNAL_NOTICE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Removes only internal review/status lines. It does not alter substantive
 * clauses and does not remove ordinary uses of the word "draft" inside a
 * sentence.
 */
export function stripInternalDraftNotices(content: string): {
  content: string;
  removed: string[];
} {
  if (isRichDocumentHtml(content)) return { content, removed: [] };
  const removed: string[] = [];
  const lines = normalize(content).split('\n').filter((line) => {
    if (!lineIsInternalNotice(line)) return true;
    removed.push(line.trim());
    return false;
  });
  return { content: lines.join('\n'), removed };
}

export function isRichDocumentHtml(content: string): boolean {
  return /<div\s+class="doc-rich"/i.test(String(content ?? ''));
}

/** Extracts readable text from the supported rich HTML subset. */
export function htmlDocumentPlainText(content: string): string {
  return String(content ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|table|header|footer)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readableDocumentText(content: string): string {
  return isRichDocumentHtml(content) ? htmlDocumentPlainText(content) : normalize(content);
}

/** Returns internal notice phrases that must never reach a customer-facing PDF. */
export function findInternalContentProblems(content: string): string[] {
  const problems = new Set<string>();
  for (const line of readableDocumentText(content).split('\n')) {
    if (!lineIsInternalNotice(line)) continue;
    for (const pattern of INTERNAL_NOTICE_PATTERNS) {
      const match = line.match(pattern);
      if (match) problems.add(match[0].toLowerCase());
    }
  }
  return [...problems];
}

/** True when any resolved customer-facing content still contains a placeholder. */
export function unresolvedDocumentVariables(content: string): string[] {
  const found = new Set<string>();
  for (const match of readableDocumentText(content).matchAll(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi)) {
    if (match[1]) found.add(match[1].toLowerCase());
  }
  return [...found].sort();
}

/**
 * Parses legacy plain-text masters and the supported Markdown subset into
 * editable blocks. No substantive text is discarded.
 */
export function parseDocumentBlocks(content: string): DocumentBlock[] {
  const lines = normalize(content).split('\n');
  const blocks: DocumentBlock[] = [];
  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;
    let type: DocumentBlockType = 'paragraph';
    let text = trimmed;
    if (/^#\s+/.test(trimmed)) {
      type = 'title';
      text = trimmed.replace(/^#\s+/, '');
    } else if (/^##\s+/.test(trimmed)) {
      type = 'heading';
      text = trimmed.replace(/^##\s+/, '');
    } else if (/^###\s+/.test(trimmed)) {
      type = 'heading';
      text = trimmed.replace(/^###\s+/, '');
    } else if (/^>\s+/.test(trimmed)) {
      type = 'metadata';
      text = trimmed.replace(/^>\s+/, '');
    } else if (/^[-*]\s+/.test(trimmed)) {
      type = 'bullet';
      text = trimmed.replace(/^[-*]\s+/, '');
    } else if (/^#/.test(trimmed)) {
      type = 'title';
      text = trimmed.replace(/^#+\s*/, '');
    } else if (index === 0) {
      type = 'title';
    } else if (index === 1) {
      type = 'heading';
    } else if (
      /^\d+\.\s+[A-Z]/.test(trimmed) &&
      trimmed.length <= 120 &&
      !/^\d+\.\d+/.test(trimmed)
    ) {
      type = 'heading';
    } else if (/^(document\s+[a-z0-9-]+\s*\|\s*version\s+|version\s+)/i.test(trimmed)) {
      type = 'metadata';
    }
    if (!text) continue;
    blocks.push({ type, text });
  }
  return blocks;
}

/** Serializes blocks back to the supported Markdown subset. */
export function serializeDocumentBlocks(blocks: DocumentBlock[]): string {
  const groups: string[] = [];
  let bullets: string[] = [];
  const flushBullets = (): void => {
    if (bullets.length) {
      groups.push(bullets.join('\n'));
      bullets = [];
    }
  };
  for (const block of blocks) {
    const text = String(block?.text ?? '').trim();
    if (!text) continue;
    if (block.type === 'bullet') {
      bullets.push(`- ${text}`);
      continue;
    }
    flushBullets();
    if (block.type === 'title') groups.push(`# ${text}`);
    else if (block.type === 'heading') groups.push(`## ${text}`);
    else if (block.type === 'metadata') groups.push(`> ${text}`);
    else groups.push(text);
  }
  flushBullets();
  return groups.join('\n\n');
}

/** Replaces the legacy internal version metadata with the active version. */
export function updateDocumentVersionLine(content: string, version: string): string {
  const next = normalize(content)
    .replace(
      /^\s*(?:\*\*)?(?:Document\s+[A-Za-z0-9_.-]+\s*\|\s*)?(?:Version(?:\*\*)?:?)(?:\*\*)?\s*.*$/gim,
      `Version ${version}`,
    )
    .replace(/^\s*>\s*Version\s+.*$/gim, `Version ${version}`);
  return next;
}

/**
 * Produces a clean, versioned revision body from an approved legacy master.
 * Only formatting markers, the internal status notice and the version metadata
 * are changed; substantive clause text is preserved.
 */
export function prepareTemplateRevisionContent(content: string, version: string): {
  content: string;
  removed: string[];
} {
  if (isRichDocumentHtml(content)) return { content, removed: [] };
  const stripped = stripInternalDraftNotices(content);
  const versioned = updateDocumentVersionLine(stripped.content, version);
  return {
    content: serializeDocumentBlocks(parseDocumentBlocks(versioned)),
    removed: stripped.removed,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isTechnicalMetadata(value: string): boolean {
  const text = value.trim();
  return (
    /^version\b/i.test(text) ||
    /^document\b.*\bversion\b/i.test(text) ||
    /^template\b/i.test(text) ||
    /\bsha-?256\b/i.test(text) ||
    /^consent version\b/i.test(text) ||
    /^status\s*:/i.test(text)
  );
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>');
}

const RICH_ALLOWED_TAGS = new Set([
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'span',
  'br',
  'hr',
  'header',
  'footer',
]);

const RICH_VOID_TAGS = new Set(['br', 'hr']);

const RICH_ALLOWED_STYLES = new Set([
  'text-align',
  'font-family',
  'font-size',
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'text-decoration',
  'margin-left',
  'padding-left',
  'border-collapse',
  'width',
]);

function safeStyleValue(property: string, value: string): string {
  const trimmed = value.trim().slice(0, 160);
  if (!trimmed || /url\s*\(|expression|javascript|<|>|\\/i.test(trimmed)) return '';
  if (property === 'text-align') {
    return /^(left|right|center|justify)$/i.test(trimmed) ? trimmed.toLowerCase() : '';
  }
  if (property === 'font-weight') {
    return /^(normal|bold|[1-9]00)$/i.test(trimmed) ? trimmed.toLowerCase() : '';
  }
  if (property === 'font-style') {
    return /^(normal|italic)$/i.test(trimmed) ? trimmed.toLowerCase() : '';
  }
  if (property === 'text-decoration') {
    return /^(none|underline|line-through)$/i.test(trimmed) ? trimmed.toLowerCase() : '';
  }
  if (property === 'color' || property === 'background-color') {
    return /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\)|[a-z]{3,20})$/i.test(trimmed) ? trimmed : '';
  }
  if (property === 'font-size' || property === 'width' || property === 'margin-left' || property === 'padding-left') {
    return /^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)?$/i.test(trimmed) ? trimmed : '';
  }
  if (property === 'font-family') {
    return /^[a-z0-9\s,'"-]{1,80}$/i.test(trimmed) ? trimmed : '';
  }
  if (property === 'border-collapse') {
    return /^(collapse|separate)$/i.test(trimmed) ? trimmed : '';
  }
  return '';
}

function sanitizeStyleAttribute(value: string): string {
  const declarations: string[] = [];
  for (const part of value.split(';')) {
    const [rawProperty, ...rest] = part.split(':');
    const property = String(rawProperty ?? '').trim().toLowerCase();
    const propertyValue = rest.join(':').trim();
    if (!RICH_ALLOWED_STYLES.has(property)) continue;
    const safe = safeStyleValue(property, propertyValue);
    if (safe) declarations.push(`${property}:${safe}`);
  }
  return declarations.join(';');
}

function sanitizeAttributes(raw: string): string {
  const attributes: string[] = [];
  const pattern = /([a-zA-Z0-9-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const match of raw.matchAll(pattern)) {
    const name = String(match[1] ?? '').toLowerCase();
    const value = String(match[3] ?? match[4] ?? match[5] ?? '');
    if (name === 'style') {
      const style = sanitizeStyleAttribute(value);
      if (style) attributes.push(`style="${escapeHtml(style)}"`);
      continue;
    }
    if ((name === 'colspan' || name === 'rowspan') && /^\d{1,2}$/.test(value)) {
      attributes.push(`${name}="${value}"`);
      continue;
    }
    if (
      (name === 'data-doc-header' ||
        name === 'data-doc-footer' ||
        name === 'data-doc-page-break') &&
      (!value || value === 'true')
    ) {
      attributes.push(`${name}="true"`);
      continue;
    }
    if (name === 'data-doc-signature' && (value === 'customer' || value === 'employee')) {
      attributes.push(`${name}="${value}"`);
    }
  }
  return attributes.length ? ` ${attributes.join(' ')}` : '';
}

/**
 * Sanitizes the owner's visual-editor HTML into a small, safe subset.
 * Scripts, event handlers, links, images, iframes, forms and external URLs are
 * never stored. Unsupported wrappers are removed while their text survives.
 */
export function sanitizeDocumentHtml(input: string): string {
  const source = String(input ?? '').slice(0, 220_000);
  const output: string[] = [];
  const stack: string[] = [];
  const tokenPattern = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+|</g;
  for (const token of source.matchAll(tokenPattern)) {
    const value = token[0];
    if (value.startsWith('<!--')) continue;
    if (!value.startsWith('<')) {
      output.push(escapeHtml(value));
      continue;
    }
    if (value === '<') {
      output.push('&lt;');
      continue;
    }
    const closing = /^<\s*\//.test(value);
    const tagMatch = value.match(/^<\s*\/?\s*([a-zA-Z0-9]+)([^>]*)>$/);
    if (!tagMatch) continue;
    const tag = String(tagMatch[1] ?? '').toLowerCase();
    const attrs = String(tagMatch[2] ?? '');
    if (!RICH_ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      const index = stack.lastIndexOf(tag);
      if (index < 0) continue;
      while (stack.length > index) {
        const open = stack.pop();
        if (open) output.push(`</${open}>`);
      }
      continue;
    }
    const cleanAttrs = sanitizeAttributes(attrs);
    output.push(`<${tag}${cleanAttrs}>`);
    if (!RICH_VOID_TAGS.has(tag) && !/\/\s*$/.test(attrs)) stack.push(tag);
  }
  while (stack.length) {
    const open = stack.pop();
    if (open) output.push(`</${open}>`);
  }
  return output.join('').slice(0, 220_000);
}

/** Wraps plain editor HTML in the marker that identifies a rich template. */
export function normalizeRichDocumentHtml(input: string): string {
  const sanitized = sanitizeDocumentHtml(input);
  if (!sanitized.trim()) return '';
  return `<div class="doc-rich">${sanitized}</div>`;
}

/** Safe customer-facing HTML for the signing reader and admin previews. */
export function renderDocumentHtml(content: string, className = 'document-rendered'): string {
  if (isRichDocumentHtml(content)) {
    const inner = sanitizeDocumentHtml(content);
    return `<div class="${escapeHtml(className)} doc-rich-rendered">${inner}</div>`;
  }
  const blocks = parseDocumentBlocks(content);
  const output: string[] = [];
  let bullets: string[] = [];
  const flushBullets = (): void => {
    if (!bullets.length) return;
    output.push(`<ul>${bullets.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
    bullets = [];
  };
  for (const block of blocks) {
    if (block.type === 'bullet') {
      bullets.push(block.text);
      continue;
    }
    flushBullets();
    if (block.type === 'metadata' && isTechnicalMetadata(block.text)) continue;
    if (block.type === 'title') output.push(`<h1 class="doc-title">${renderInline(block.text)}</h1>`);
    else if (block.type === 'heading') output.push(`<h2 class="doc-heading">${renderInline(block.text)}</h2>`);
    else if (block.type === 'metadata') output.push(`<p class="doc-meta">${renderInline(block.text)}</p>`);
    else output.push(`<p>${renderInline(block.text)}</p>`);
  }
  flushBullets();
  return `<div class="${escapeHtml(className)}">${output.join('')}</div>`;
}

/** Plain text suitable for PDF text commands; removes inline Markdown markers. */
export function plainDocumentText(value: string): string {
  if (isRichDocumentHtml(value)) return htmlDocumentPlainText(value);
  return String(value ?? '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^\s*[#>]+\s*/g, '')
    .trim();
}
