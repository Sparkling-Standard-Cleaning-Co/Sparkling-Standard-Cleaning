// Shared Markdown -> printable HTML renderer for owner-facing documents.
// Supports headings, paragraphs, lists, blockquotes, pipe tables, emphasis,
// links, inline code and horizontal rules.

export function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function inline(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let list = null;
  let inQuote = false;
  let quoteList = false;
  let table = null;
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };

  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      if (quoteList) html.push('</ul>');
      html.push('</blockquote>');
      inQuote = false;
      quoteList = false;
    }
  };
  const closeTable = () => {
    if (table) {
      const head = table.rows.shift();
      html.push('<table><thead><tr>' + head.map((cell) => `<th>${inline(cell)}</th>`).join('') + '</tr></thead><tbody>');
      for (const row of table.rows) {
        html.push('<tr>' + row.map((cell) => `<td>${inline(cell)}</td>`).join('') + '</tr>');
      }
      html.push('</tbody></table>');
      table = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      closeList();
      closeQuote();
      closeTable();
      continue;
    }
    if (line.startsWith('|')) {
      flushParagraph();
      const cells = line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
      if (!table) table = { rows: [] };
      table.rows.push(cells);
      continue;
    }
    closeTable();
    if (line.startsWith('>')) {
      flushParagraph();
      if (!inQuote) {
        html.push('<blockquote>');
        inQuote = true;
        quoteList = false;
      }
      const quoted = line.replace(/^>\s?/, '');
      if (/^-\s/.test(quoted)) {
        if (!quoteList) {
          html.push('<ul>');
          quoteList = true;
        }
        html.push(`<li>${inline(quoted.replace(/^-\s*/, ''))}</li>`);
      } else {
        if (quoteList) {
          html.push('</ul>');
          quoteList = false;
        }
        if (quoted.trim()) html.push(`<p>${inline(quoted)}</p>`);
      }
      continue;
    }
    closeQuote();
    if (/^#{1,6}\s/.test(line)) {
      flushParagraph();
      closeList();
      const level = line.match(/^#+/)[0].length;
      html.push(`<h${level}>${inline(line.replace(/^#+\s*/, ''))}</h${level}>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      closeList();
      html.push('<hr />');
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      flushParagraph();
      if (list !== 'ul') {
        closeList();
        html.push('<ul>');
        list = 'ul';
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s*/, ''))}</li>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      flushParagraph();
      if (list !== 'ol') {
        closeList();
        html.push('<ol>');
        list = 'ol';
      }
      html.push(`<li>${inline(line.replace(/^\d+\.\s*/, ''))}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  closeQuote();
  closeTable();
  return html.join('\n');
}

const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.2rem 2.4rem 3rem; background: #fbf7f2; color: #2c2421;
    font-family: Georgia, 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.55;
  }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 .4rem; color: #6d343c; }
  h2 { font-size: 14pt; margin: 1.7rem 0 .5rem; color: #6d343c; border-bottom: 1px solid #e5d8c8; padding-bottom: .2rem; }
  h3 { font-size: 12pt; margin: 1.2rem 0 .3rem; }
  p, li { orphans: 3; widows: 3; }
  blockquote { margin: 1rem 0; padding: .8rem 1rem; background: #f6e9e6; border-left: 4px solid #9a5b61; }
  blockquote p { margin: .35rem 0; font-size: 10.5pt; }
  table { width: 100%; border-collapse: collapse; margin: .8rem 0 1.2rem; font-size: 10pt; }
  th, td { border: 1px solid #dccdbc; padding: .4rem .5rem; text-align: left; vertical-align: top; }
  th { background: #f3e8d8; }
  code { font-family: Consolas, monospace; font-size: 9.5pt; background: #f0e6dc; padding: 0 .2rem; }
  hr { border: 0; border-top: 1px solid #dccdbc; margin: 2rem 0; }
  ul, ol { padding-left: 1.4rem; }
  li { margin: .25rem 0; }
  strong { color: #4a2e33; }
  @page { size: Letter; margin: 0.75in; }
  @media print {
    body { background: #fff; padding: 0; font-size: 10.5pt; }
    h2 { break-after: avoid; }
    blockquote { background: #f7efec; }
    a { color: inherit; text-decoration: none; }
  }
`;

export function htmlDocument(title, markdown) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head><body><main>
${markdownToHtml(markdown)}
</main></body></html>`;
}

// ── Write everything ────────────────────────────────────────────────────────
