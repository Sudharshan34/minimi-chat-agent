import assert from 'node:assert/strict';
import { resolveDay } from './temporal.js';

const now = new Date('2026-11-11T05:00:00Z'); // Wed 11 Nov 2026, 10:30 IST
const tz = 'Asia/Kolkata';
const day = (t: string) => resolveDay(t, now, tz).map((r) => new Date(r.from + 5.5 * 36e5).toISOString().slice(0, 10));

assert.deepEqual(day('What did I ask you on 3 November? Is your answer still correct today?'), ['2026-11-03']);
assert.deepEqual(day('Last Tuesday I asked you about Postgres hosting.'), ['2026-11-03', '2026-11-10']);
assert.deepEqual(day('On Monday we shortlisted 5 CRM tools for a 20-person sales team.'), ['2026-11-09']);
assert.deepEqual(day('Any news on Postgres hosting prices?'), []);
console.log('temporal ok');
