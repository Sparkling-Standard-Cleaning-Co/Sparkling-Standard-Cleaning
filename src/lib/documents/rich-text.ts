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
  const removed: string[] = [];
  const lines = normalize(content).split('\n').filter((line) => {
    if (!lineIsInternalNotice(line)) return true;
    removed.push(line.trim());
    return false;
  });
  return { content: lines.join('\n'), removed };
}

/** Returns internal notice phrases that must never reach a customer-facing PDF. */
export function findInternalContentProblems(content: string): string[] {
  const problems = new Set<string>();
  for (const line of normalize(content).split('\n')) {
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
  for (const match of normalize(content).matchAll(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi)) {
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

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>');
}

/** Safe customer-facing HTML for the signing reader and admin previews. */
export function renderDocumentHtml(content: string, className = 'document-rendered'): string {
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
  return String(value ?? '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^\s*[#>]+\s*/g, '')
    .trim();
}
