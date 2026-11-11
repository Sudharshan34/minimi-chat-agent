import 'dotenv/config';
import express from 'express';
import { runTurn, type Emit } from './agent.js';
import { history } from './memory.js';

if (!process.env.GEMINI_API_KEY) console.warn('Missing GEMINI_API_KEY: copy .env.example to .env and set it.');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

app.get('/api/history', (req, res) => res.json(history(String(req.query.conv ?? ''))));

app.post('/api/chat', async (req, res) => {
  const { conv, message, tz } = req.body ?? {};
  if (typeof conv !== 'string' || typeof message !== 'string' || !message.trim()) return void res.status(400).json({ error: 'conv and message required' });
  let zone = 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); zone = tz; } catch { /* keep UTC */ }

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const emit: Emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    await runTurn({ conv, text: message.trim(), tz: zone, emit, signal: ac.signal });
  } catch (e: any) {
    if (!ac.signal.aborted) emit({ type: 'error', text: e?.message ?? 'Something went wrong. Try again.' });
  }
  res.end();
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Chat agent on http://localhost:${port}`));
