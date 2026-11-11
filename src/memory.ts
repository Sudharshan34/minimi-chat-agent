import Database from 'better-sqlite3';
import fs from 'node:fs';
import { offsetMin, resolveDay } from './temporal.js';

fs.mkdirSync('data', { recursive: true });
const db = new Database('data/chat.db');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS turns(
  id INTEGER PRIMARY KEY, conv TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, sources TEXT, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS turns_ts ON turns(ts);
CREATE INDEX IF NOT EXISTS turns_conv ON turns(conv, ts);
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(content, content='turns', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns
  BEGIN INSERT INTO turns_fts(rowid, content) VALUES (new.id, new.content); END;
`);

export type Turn = { id: number; conv: string; role: 'user' | 'assistant'; content: string; sources: string | null; ts: number };

export const recent = (conv: string, n = 10) =>
  db.prepare('SELECT * FROM (SELECT * FROM turns WHERE conv=? ORDER BY ts DESC, id DESC LIMIT ?) ORDER BY ts, id').all(conv, n) as Turn[];

const byRange = (from: number, to: number, n = 14) =>
  db.prepare('SELECT * FROM turns WHERE ts>=? AND ts<? ORDER BY ts, id LIMIT ?').all(from, to, n) as Turn[];

const STOP = new Set('the and for you your what when did does have has had are was were this that with from they them then any all can could would about since last still correct changed change today asked ask tell said just like need want please into than there their been being how why who which where more some other'.split(' '));
function ftsSearch(text: string, n = 6) {
  const words = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)))].slice(0, 8);
  if (!words.length) return [];
  return db.prepare(
    'SELECT t.* FROM turns_fts f JOIN turns t ON t.id=f.rowid WHERE turns_fts MATCH ? ORDER BY rank LIMIT ?',
  ).all(words.map((w) => `"${w}"`).join(' OR '), n) as Turn[];
}

export function save(conv: string, user: string, assistant: string, sources: unknown[], tUser: number, tAsst: number) {
  const ins = db.prepare('INSERT INTO turns(conv, role, content, sources, ts) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    ins.run(conv, 'user', user, null, tUser);
    ins.run(conv, 'assistant', assistant, JSON.stringify(sources), tAsst);
  })();
}

const PAST_REF = /\b(i|we)\s+(asked|told|said|shortlisted|mentioned|picked|chose)\b|\b(earlier|before|previous(ly)?|last time|remember|recap|since then|still (correct|true|right|accurate)|changed|you (said|told|answered))\b/i;

/** Deterministic recall: pull dated turns the question points at. Not a model tool. */
export function buildMemory(text: string, now: Date, tz: string, skip: Set<number>) {
  const fmt = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(ms);
  const off = offsetMin(tz, now) * 6e4;
  const ago = (ms: number) => { const d = Math.floor((now.getTime() + off) / 864e5) - Math.floor((ms + off) / 864e5); return d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
  const line = (t: Turn) => `[${fmt(t.ts)}, ${ago(t.ts)}] ${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.slice(0, 1200)}`;

  const days = resolveDay(text, now, tz);
  if (!days.length && !PAST_REF.test(text)) return '';

  const out: string[] = [];
  let rows: Turn[] = [];
  for (const d of days) {
    const label = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full' }).format(d.from);
    const found = byRange(d.from, d.to).filter((t) => !skip.has(t.id));
    out.push(found.length ? `Recorded turns from ${label}:` : `The user may mean ${label}. There are NO recorded turns from that day.`);
    out.push(...found.map(line));
    rows = rows.concat(found);
  }
  if (!rows.length) {
    const hits = ftsSearch(text).filter((t) => !skip.has(t.id)).sort((a, b) => a.ts - b.ts);
    if (hits.length) out.push('Possibly related past turns (matched by keywords):', ...hits.map(line));
  }
  return out.join('\n');
}

export const history = (conv: string) =>
  recent(conv, 60).map(({ role, content, sources, ts }) => ({ role, content, ts, sources: sources ? JSON.parse(sources) : [] }));
