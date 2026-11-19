/**
 * @jest-environment node
 */
// ARU-167 QA: extra cases for the IP / user agent guard (AC 7–10) beyond the dev tests.
import { findIpColumns, findIpHeaders } from './aru167-no-ip-guard.test';

const fs = jest.requireActual<{ readFileSync: (f: string, e: 'utf8') => string; existsSync: (p: string) => boolean }>('fs');

describe('ARU-167 QA › migration guard (AC 7)', () => {
  it.each([
    ['CREATE TABLE IF NOT EXISTS public.visits (id uuid, Ip INET);', 'ip'],
    ['create table "public"."visits" ("ip" text);', 'ip'],
    ['create table visits (like profiles including all, ip_address varchar(45));', 'ip_address'],
    ['create unlogged table visits (id int, user_agent varchar(512) not null default \'\');', 'user_agent'],
    ['alter table visits alter column a set data type cidr;', 'a'],
    ['ALTER TABLE visits ADD COLUMN USER_AGENT TEXT;', 'user_agent'],
    ['alter table visits rename addr to ip_address;', 'ip_address'],
    ['create table visits (\n  id int,\n  -- a comment\n  ip inet\n);', 'ip'],
    ['create table visits (id int, history inet[]);', 'history'],
  ])('fails on %s', (sql, column) => {
    expect(findIpColumns('m.sql', sql)).toEqual([`m.sql: ${column}`]);
  });

  it('names every bad column in one file', () => {
    expect(findIpColumns('m.sql', 'create table a (ip inet, user_agent text); alter table b add column ip_address text;'))
      .toEqual(['m.sql: ip', 'm.sql: user_agent', 'm.sql: ip_address']);
  });

  it.each([
    'create table x (zip text, description text, tip text, recipient text, ipad_model text, user_agents_count int);',
    'alter table x add column ships int;',
    'alter table "auth"."sessions" alter column ip type inet;',
    'alter table auth.sessions rename column ip to ip_address;',
    'create trigger clear_session_ip before insert or update on auth.sessions for each row execute function clear_session_ip();',
    "comment on column x.a is 'never store ip addresses or user_agent';",
    'create index on x (zip);',
  ])('passes on %s (AC 9, no false positives)', (sql) => {
    expect(findIpColumns('ok.sql', sql)).toEqual([]);
  });
});

describe('ARU-167 QA › header guard (AC 8)', () => {
  it.each([
    ["select current_setting('request.headers')::json->>'x-forwarded-for';", 'x-forwarded-for'],
    ["const h = { 'X-REAL-IP': 1 }", 'x-real-ip'],
    ['h.get(`Cf-Connecting-Ip`)', 'cf-connecting-ip'],
  ])('fails on %s (any case, SQL or TS)', (code, header) => {
    expect(findIpHeaders('supabase/functions/f/index.sql', code)).toEqual([`supabase/functions/f/index.sql: ${header}`]);
  });

  it('names every header found in one file', () => {
    expect(findIpHeaders('src/a.ts', "get('x-forwarded-for'); get('x-real-ip'); get('cf-connecting-ip');")).toHaveLength(3);
  });

  it('passes on similar but different headers', () => {
    expect(findIpHeaders('src/a.ts', "get('x-forwarded-host'); get('x-real-ipx'); get('x-request-id');")).toEqual([]);
  });
});

describe('ARU-167 QA › CI wiring and docs (AC 10–12)', () => {
  it('npm test runs jest over __tests__, so the guard runs in CI', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.test).toMatch(/jest/);
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toMatch(/npm test/);
    expect(ci).toContain('supabase/tests/run.sh');
  });

  it('README states the rule in Roles and access and lists 0068 in Setup', () => {
    const readme = fs.readFileSync('README.md', 'utf8');
    const roles = readme.slice(readme.indexOf('## Roles and access'));
    expect(roles.slice(0, 1500)).toMatch(/Sham never stores IP addresses or user agents/);
    expect(roles.slice(0, 1500)).toMatch(/auth\.sessions/);
    expect(readme.slice(0, readme.indexOf('## Roles and access'))).toMatch(/0068_no_session_ip\.sql/);
  });

  it('agent-pipeline Guardrails has the exact AC 12 sentence', () => {
    const doc = fs.readFileSync('docs/agent-pipeline.md', 'utf8');
    const guard = doc.slice(doc.indexOf('Guardrails'));
    expect(guard).toContain(
      'Never store IP addresses or user agents: no such column in `public`, and no reading of `x-forwarded-for`, `x-real-ip` or `cf-connecting-ip` (ARU-167).',
    );
  });
});
