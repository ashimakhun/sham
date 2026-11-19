/**
 * @jest-environment node
 */
// ARU-167: Sham never stores IP addresses or user agents. This guard runs in CI (`npm test`) and fails when
//  - a migration adds a column to a `public` table named ip / ip_address / user_agent, or of type inet / cidr
//    (create table, alter table … add column, rename column … to, alter column … type), naming the file and column;
//  - code in src/ or supabase/functions/ mentions the header x-forwarded-for, x-real-ip or cf-connecting-ip as a
//    string literal (any case), naming the file.
// Statements on other schemas (auth, storage, cron, …) are ignored, and so is this file (it's outside both folders).
// Paths are relative to the repo root (Jest's working directory), as in aru74-migration-numbers-qa.test.ts.
const fs = jest.requireActual<{
  readFileSync: (file: string, encoding: 'utf8') => string;
  readdirSync: (dir: string, opts: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[];
  existsSync: (p: string) => boolean;
}>('fs');

const BAD_NAMES = new Set(['ip', 'ip_address', 'user_agent']);
const BAD_TYPES = new Set(['inet', 'cidr']);
const BAD_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'];

const ident = (s: string) => (s.startsWith('"') ? s.slice(1, -1) : s).toLowerCase();
const IDENT = String.raw`(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)`;
const QNAME = String.raw`(${IDENT})(?:\s*\.\s*(${IDENT}))?`;

/** Schema of a possibly qualified table name; unqualified counts as public. */
const schemaOf = (a: string, b: string | undefined) => (b === undefined ? 'public' : ident(a));

/** Removes comments, string literals and dollar-quoted bodies, then splits into statements. */
function statements(sql: string): string[] {
  const clean = sql
    .replace(/\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
  return clean.split(';').map((s) => s.trim()).filter(Boolean);
}

/** Splits on commas that aren't inside parentheses. */
function topLevelParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const isBad = (name: string, type: string) => BAD_NAMES.has(name) || BAD_TYPES.has(type.replace(/\[\]$/, ''));
const CONSTRAINT_WORDS = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like']);

/** Returns "file: column" for every IP-like column added to a public table. */
export function findIpColumns(file: string, sql: string): string[] {
  const found: string[] = [];
  for (const st of statements(sql)) {
    const create = new RegExp(
      String.raw`^create\s+(?:(?:global|local)\s+)?(?:(?:temporary|temp|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?${QNAME}\s*\(([\s\S]*)\)`,
      'i',
    ).exec(st);
    if (create) {
      if (schemaOf(create[1], create[2]) !== 'public') continue;
      for (const part of topLevelParts(create[3])) {
        const m = new RegExp(String.raw`^(${IDENT})\s+(${IDENT}(?:\[\])?)`).exec(part);
        if (!m || CONSTRAINT_WORDS.has(ident(m[1]))) continue;
        if (isBad(ident(m[1]), ident(m[2]))) found.push(`${file}: ${ident(m[1])}`);
      }
      continue;
    }
    const alter = new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QNAME}\s+([\s\S]*)$`, 'i').exec(st);
    if (!alter || schemaOf(alter[1], alter[2]) !== 'public') continue;
    for (const action of topLevelParts(alter[3])) {
      const add = new RegExp(
        String.raw`^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})\s+(${IDENT}(?:\[\])?)`,
        'i',
      ).exec(action);
      if (add && !CONSTRAINT_WORDS.has(ident(add[1])) && isBad(ident(add[1]), ident(add[2])))
        found.push(`${file}: ${ident(add[1])}`);
      const rename = new RegExp(String.raw`^rename\s+(?:column\s+)?${IDENT}\s+to\s+(${IDENT})`, 'i').exec(action);
      if (rename && BAD_NAMES.has(ident(rename[1]))) found.push(`${file}: ${ident(rename[1])}`);
      const retype = new RegExp(
        String.raw`^alter\s+(?:column\s+)?(${IDENT})\s+(?:set\s+data\s+)?type\s+(${IDENT}(?:\[\])?)`,
        'i',
      ).exec(action);
      if (retype && BAD_TYPES.has(ident(retype[2]).replace(/\[\]$/, ''))) found.push(`${file}: ${ident(retype[1])}`);
    }
  }
  return found;
}

/** Returns "file: header" for every client-IP header named as a string literal. */
export function findIpHeaders(file: string, code: string): string[] {
  const found: string[] = [];
  for (const h of BAD_HEADERS) {
    if (new RegExp(String.raw`(['"\x60])${h}\1`, 'i').test(code)) found.push(`${file}: ${h}`);
  }
  return found;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx|js|jsx|sql)$/.test(e.name) ? [p] : [];
  });
}

describe('the repo stores no IP addresses or user agents', () => {
  it('no migration adds an IP or user agent column to a public table', () => {
    const files = walk('supabase/migrations').filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(60);
    expect(files.flatMap((f) => findIpColumns(f, fs.readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('no code in src/ or supabase/functions/ reads a client IP header', () => {
    const files = [...walk('src'), ...walk('supabase/functions')];
    expect(files.length).toBeGreaterThan(10);
    expect(files.flatMap((f) => findIpHeaders(f, fs.readFileSync(f, 'utf8')))).toEqual([]);
  });

  it("this story's own migration (auth.sessions only) passes", () => {
    const f = 'supabase/migrations/0068_no_session_ip.sql';
    expect(findIpColumns(f, fs.readFileSync(f, 'utf8'))).toEqual([]);
  });
});

describe('the migration guard', () => {
  it.each([
    ['alter table foo add column ip inet;', 'ip'],
    ['create table public.x (id int, IP_Address text);', 'ip_address'],
    ['create table x (user_agent text);', 'user_agent'],
    ['create table x (id uuid primary key, seen_from inet not null);', 'seen_from'],
    ['create table x (id int, nets cidr[]);', 'nets'],
    ['alter table public.profiles add "User_Agent" text;', 'user_agent'],
    ['alter table if exists profiles add column if not exists last_ip inet default null;', 'last_ip'],
    ['alter table profiles rename column addr to ip;', 'ip'],
    ['alter table profiles alter column addr type inet using addr::inet;', 'addr'],
    ['alter table only public.profiles add column x int, add column ip_address text;', 'ip_address'],
  ])('fails on %s and names the file and column', (sql, column) => {
    expect(findIpColumns('supabase/migrations/9999_bad.sql', sql)).toEqual([`supabase/migrations/9999_bad.sql: ${column}`]);
  });

  it.each([
    'create table x (id int, zip text, description text, tip_amount numeric, ip_count int);',
    'alter table x add column zip text;',
    'alter table auth.sessions add column ip inet;',
    'create table storage.x (ip inet);',
    'create table cron.x (user_agent text);',
    "-- create table x (ip inet);\nselect 'alter table x add column ip inet';",
    'create function f() returns void language plpgsql as $$ begin create table x (ip inet); end $$;',
    'create table x (id int, constraint ip check (true));',
    'update auth.sessions set ip = null, user_agent = null;',
  ])('passes on %s', (sql) => {
    expect(findIpColumns('ok.sql', sql)).toEqual([]);
  });
});

describe('the header guard', () => {
  it.each([
    ["const ip = req.headers.get('X-Forwarded-For');", 'x-forwarded-for'],
    ["const ip = req.headers.get('x-real-ip');", 'x-real-ip'],
    ['const ip = req.headers.get("CF-Connecting-IP");', 'cf-connecting-ip'],
    ['const h = headers[`x-real-ip`];', 'x-real-ip'],
  ])('fails on %s and names the file', (code, header) => {
    expect(findIpHeaders('supabase/functions/x/index.ts', code)).toEqual([`supabase/functions/x/index.ts: ${header}`]);
  });

  it('passes on code that names no such header', () => {
    expect(findIpHeaders('src/x.ts', "req.headers.get('authorization'); const forwarded = 'x-forwarded-proto';")).toEqual([]);
  });
});
