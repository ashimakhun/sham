// A small Markdown subset for notes (ARU-28; reusable for ARU-30): **bold**, _italic_ (or *italic*), "- " bulleted
// and "1. " numbered lists, and [text](https://…) links. Parsing for display, plus the text edits the formatting
// toolbar makes. Pure functions, so they behave the same on iOS, Android and web.

export const NOTES_MAX = 10_000;
/** The character counter shows from here on (ARU-28 AC 6). */
export const NOTES_COUNTER_FROM = 9_000;

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'link'; text: string; url: string };

export type Block =
  | { type: 'paragraph'; lines: Inline[][] }
  | { type: 'bullets'; items: Inline[][] }
  | { type: 'numbers'; items: { n: number; content: Inline[] }[] };

export type Selection = { start: number; end: number };
export type Edit = { text: string; selection: Selection };

const BULLET = /^(\s*)[-*•] (.*)$/;
const NUMBER = /^(\s*)(\d{1,4})[.)] (.*)$/;
const LIST_PREFIX = /^\s*(?:[-*•]|\d{1,4}[.)]) /;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;

/** Only web links open (same rule as a meeting's location). */
export function isWebUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\/\S+$/i.test(url.trim());
}

/** Inline formatting of one line. Unclosed markers stay as plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ type: 'text', text: plain });
    plain = '';
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    if (rest.startsWith('**')) {
      const close = text.indexOf('**', i + 2);
      if (close > i + 2) {
        flush();
        out.push({ type: 'bold', children: parseInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    } else if (rest[0] === '_' || rest[0] === '*') {
      const marker = rest[0];
      const close = findSingle(text, marker, i + 1);
      if (close > i + 1 && text[i + 1] !== ' ' && text[close - 1] !== ' ') {
        flush();
        out.push({ type: 'italic', children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    } else if (rest[0] === '[') {
      const m = LINK.exec(rest);
      if (m && isWebUrl(m[2])) {
        flush();
        out.push({ type: 'link', text: m[1], url: m[2] });
        i += m[0].length;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }
  flush();
  return out;
}

/** Next single marker (not part of "**") at or after `from`, or -1. */
function findSingle(text: string, marker: string, from: number) {
  for (let j = from; j < text.length; j++) {
    if (text[j] !== marker) continue;
    if (marker === '*' && (text[j + 1] === '*' || text[j - 1] === '*')) continue;
    return j;
  }
  return -1;
}

/** Splits notes into paragraphs and lists. Blank lines separate blocks. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const last = blocks[blocks.length - 1];
    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    if (bullet) {
      const content = parseInline(bullet[2]);
      if (last?.type === 'bullets') last.items.push(content);
      else blocks.push({ type: 'bullets', items: [content] });
    } else if (number) {
      const item = { n: Number(number[2]), content: parseInline(number[3]) };
      if (last?.type === 'numbers') last.items.push(item);
      else blocks.push({ type: 'numbers', items: [item] });
    } else if (line.trim() === '') {
      if (last && !(last.type === 'paragraph' && last.lines.length === 0))
        blocks.push({ type: 'paragraph', lines: [] });
    } else if (last?.type === 'paragraph' && last.lines.length > 0) {
      last.lines.push(parseInline(line));
    } else {
      if (last?.type === 'paragraph') blocks.pop();
      blocks.push({ type: 'paragraph', lines: [parseInline(line)] });
    }
  }
  // Drop the empty separator blocks; they only split lists and paragraphs.
  return blocks.filter((b) => !(b.type === 'paragraph' && b.lines.length === 0));
}

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.type === 'text' || n.type === 'link' ? n.text : inlineText(n.children)))
    .join('');
}

/**
 * The text of Markdown without its symbols, for one-line previews (ARU-38): bold and italic become plain text, a link
 * becomes its text, list markers are dropped, and lines, list items and paragraphs are joined with single spaces.
 * Unclosed markers and non-web links stay literal, as `parseInline` leaves them.
 */
export function markdownToPlainText(source: string): string {
  const pieces: string[] = [];
  for (const b of parseMarkdown(source)) {
    if (b.type === 'paragraph') pieces.push(...b.lines.map(inlineText));
    else if (b.type === 'bullets') pieces.push(...b.items.map(inlineText));
    else pieces.push(...b.items.map((item) => inlineText(item.content)));
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Toolbar edits

/** Start and end offsets of each line touched by the selection. */
function touchedLines(text: string, sel: Selection) {
  const lines: { start: number; end: number }[] = [];
  let start = text.lastIndexOf('\n', sel.start - 1) + 1;
  for (;;) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    lines.push({ start, end });
    if (end >= sel.end || end === text.length) break;
    start = end + 1;
  }
  return lines;
}

function normalize(sel: Selection): Selection {
  return sel.start <= sel.end ? sel : { start: sel.end, end: sel.start };
}

/**
 * Bold (`**`) or italic (`_`). With only a cursor, inserts an empty pair with the cursor inside, or removes an empty
 * pair around the cursor. With a selection, wraps the selected text on each line (outside any list prefix and
 * surrounding spaces); if every selected part is already wrapped (inside or just outside the selection), unwraps.
 */
export function toggleWrap(text: string, selection: Selection, marker: '**' | '_'): Edit {
  const sel = normalize(selection);
  const m = marker.length;
  if (sel.start === sel.end) {
    const at = sel.start;
    if (text.slice(at - m, at) === marker && text.slice(at, at + m) === marker) {
      return { text: text.slice(0, at - m) + text.slice(at + m), selection: { start: at - m, end: at - m } };
    }
    return { text: text.slice(0, at) + marker + marker + text.slice(at), selection: { start: at + m, end: at + m } };
  }

  // The selected part of each touched line, trimmed of spaces and (at the line start) of a list prefix.
  const parts = touchedLines(text, sel)
    .map((line) => {
      let start = Math.max(line.start, sel.start);
      let end = Math.min(line.end, sel.end);
      if (start === line.start) {
        const prefix = LIST_PREFIX.exec(text.slice(line.start, line.end));
        if (prefix) start = Math.min(end, line.start + prefix[0].length);
      }
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      return { start, end };
    })
    .filter((p) => p.end > p.start);
  if (parts.length === 0) return { text, selection: sel };

  const wrappedInside = (p: { start: number; end: number }) =>
    p.end - p.start >= 2 * m + 1 &&
    text.slice(p.start, p.start + m) === marker &&
    text.slice(p.end - m, p.end) === marker;
  const wrappedOutside = (p: { start: number; end: number }) =>
    text.slice(p.start - m, p.start) === marker && text.slice(p.end, p.end + m) === marker;

  const unwrap = parts.every((p) => wrappedInside(p) || wrappedOutside(p));
  let out = '';
  let cursor = 0;
  let delta = 0;
  let firstStart = sel.start;
  let lastEnd = sel.end;
  for (const [idx, p] of parts.entries()) {
    if (unwrap && wrappedInside(p)) {
      out += text.slice(cursor, p.start) + text.slice(p.start + m, p.end - m);
      cursor = p.end;
      if (idx === 0) firstStart = p.start + delta;
      lastEnd = p.end + delta - 2 * m;
      delta -= 2 * m;
    } else if (unwrap) {
      out += text.slice(cursor, p.start - m) + text.slice(p.start, p.end);
      cursor = p.end + m;
      if (idx === 0) firstStart = p.start - m + delta;
      lastEnd = p.end + delta - m;
      delta -= 2 * m;
    } else {
      out += text.slice(cursor, p.start) + marker + text.slice(p.start, p.end) + marker;
      cursor = p.end;
      if (idx === 0) firstStart = p.start + delta + m;
      lastEnd = p.end + delta + m;
      delta += 2 * m;
    }
  }
  out += text.slice(cursor);
  // Keep the formatted text selected, so a second tap toggles it back.
  return { text: out, selection: { start: firstStart, end: Math.max(firstStart, lastEnd) } };
}

/**
 * Bulleted ("- ") or numbered ("1. ", "2. ", …) list on every line the selection touches. If all of them (ignoring
 * blank lines in a multi-line selection) already are that kind of list, the prefixes are removed; otherwise any other
 * list prefix is replaced.
 */
export function toggleList(text: string, selection: Selection, kind: 'bullets' | 'numbers'): Edit {
  const sel = normalize(selection);
  const lines = touchedLines(text, sel);
  const multi = lines.length > 1;
  const target = lines.filter((l) => !multi || text.slice(l.start, l.end).trim() !== '');
  if (target.length === 0) return { text, selection: sel };
  const re = kind === 'bullets' ? BULLET : NUMBER;
  const remove = target.every((l) => re.test(text.slice(l.start, l.end)));

  let out = text.slice(0, lines[0].start);
  let n = 0;
  let delta = 0;
  for (const [idx, l] of lines.entries()) {
    const line = text.slice(l.start, l.end);
    let next = line;
    if (target.includes(l)) {
      const stripped = line.replace(LIST_PREFIX, '');
      next = remove ? stripped : (kind === 'bullets' ? '- ' : `${++n}. `) + stripped;
    }
    delta += next.length - line.length;
    out += next + (idx < lines.length - 1 ? '\n' : '');
  }
  out += text.slice(lines[lines.length - 1].end);
  // One line: the cursor moves with the text (never before the line start). Several: select the changed block.
  const lineStart = lines[0].start;
  const selStart = multi ? lineStart : Math.max(lineStart, sel.start + delta);
  const selEnd = multi ? lines[lines.length - 1].end + delta : Math.max(lineStart, sel.end + delta);
  return { text: out, selection: { start: selStart, end: Math.max(selStart, selEnd) } };
}

/**
 * Turns the selection into a link: `[selection](url)`; with only a cursor, inserts `[url](url)`. The URL must be
 * http/https; returns an error message otherwise (the text is unchanged).
 */
export function insertLink(text: string, selection: Selection, url: string): Edit | { error: string } {
  const href = url.trim();
  if (!isWebUrl(href)) return { error: 'Enter a web link starting with http:// or https://' };
  const sel = normalize(selection);
  const selected = text.slice(sel.start, sel.end).trim();
  if (selected.includes('\n')) return { error: 'Select text on one line to make a link' };
  const label = (selected || href).replace(/[[\]]/g, '');
  const link = `[${label}](${href})`;
  const out = text.slice(0, sel.start) + link + text.slice(sel.end);
  const end = sel.start + link.length;
  return { text: out, selection: { start: end, end } };
}

/** "9,250 / 10,000" once the notes reach NOTES_COUNTER_FROM characters, otherwise null. */
export function notesCounter(length: number) {
  if (length < NOTES_COUNTER_FROM) return null;
  const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${fmt(length)} / ${fmt(NOTES_MAX)}`;
}
