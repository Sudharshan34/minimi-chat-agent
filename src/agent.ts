import { FunctionCallingConfigMode, GoogleGenAI, Type } from '@google/genai';
import { buildMemory, recent, save } from './memory.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.MODEL || 'gemini-3.1-flash-lite';

export type Emit = (e: { type: 'status' | 'text' | 'error'; text: string } | { type: 'sources'; sources: { url: string; title: string }[] } | { type: 'done' }) => void;

const system = (now: Date, tz: string) => `You are a fast, accurate chat assistant with one tool: web_search.

Now: ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(now)} (${tz}). Your training data is older than this.

Rules:
- Anything that can change (prices, plans, versions, releases, news, who holds a role, "current"/"latest") must be searched before you answer. Timeless facts and small talk need no search.
- Search economically: focused queries, one per item when comparing several things, and make independent searches in the same step. Prefer official sources (pricing pages, changelogs, release notes) and note their dates.
- For "what changed since <date>?" use the tool's "since" argument (YYYY-MM-DD) so results are newer than that date.
- <memory_from_past_chats> contains real past turns with timestamps. It is the only record of earlier conversations. Never invent one. If the user asks about a past exchange and memory says there is none, say you have no record of it and ask them to remind you.
- For "still correct?" / "has anything changed since?": take the old answer from memory, re-check its specific claims with search, then say plainly what changed, what did not, and the date of the original answer. Report a change only if a source supports it.
- Trust official and established sources (company sites, major outlets, review sites). Ignore social media, video and forum posts. If a figure only appears in rumours, leaks or weak sources, call it unconfirmed instead of stating it as fact.
- When re-checking an earlier answer, start with a one-line verdict: Unchanged, Changed, or Could not verify. Then give the evidence, with dates.
- Never say an earlier answer is still correct, or that nothing changed, unless you searched in this turn and a source supports it.
- If sources conflict or you cannot verify something, say so. Never pad.
- Lead with the answer. Short paragraphs; short lists only when comparing; no tables. Cite key claims with markdown links using URLs from the search results only. No preamble like "I'll search".`;

const tools = [{
  functionDeclarations: [{
    name: 'web_search',
    description: 'Search the web for current information. Returns titles, URLs and text snippets.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Focused search query.' },
        since: { type: Type.STRING, description: 'Optional. Only results published on or after this date, YYYY-MM-DD.' },
      },
      required: ['query'],
    },
  }],
}];

async function webSearch(args: { query?: string; since?: string }) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { error: 'TAVILY_API_KEY is not set' };
  try {
    const body: Record<string, unknown> = {
      query: args.query, max_results: 6, search_depth: 'basic',
      exclude_domains: ['facebook.com', 'instagram.com', 'youtube.com', 'tiktok.com', 'x.com', 'pinterest.com', 'reddit.com', 'quora.com'],
    };
    if (args.since && /^\d{4}-\d{2}-\d{2}$/.test(args.since)) body.start_date = args.since;
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { error: `search failed (${r.status})` };
    const j: any = await r.json();
    return { results: (j.results ?? []).map((x: any) => ({ title: x.title, url: x.url, published: x.published_date, snippet: String(x.content ?? '').slice(0, 700) })) };
  } catch (e: any) {
    return { error: `search failed: ${e?.message ?? e}` };
  }
}

const RECHECK = /\bstill (correct|true|right|accurate|valid)\b|\b(changed|updated|up to date|anything new|new since|since then)\b/i;

export async function runTurn(o: { conv: string; text: string; tz: string; emit: Emit; signal: AbortSignal }) {
  const { conv, text, tz, emit, signal } = o;
  const now = new Date();
  const hist = recent(conv, 10);
  const mem = buildMemory(text, now, tz, new Set(hist.map((h) => h.id)));

  const contents: any[] = hist.map((h) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] }));
  while (contents[0]?.role === 'model') contents.shift();
  contents.push({ role: 'user', parts: [{ text: mem ? `<memory_from_past_chats>\n${mem}\n</memory_from_past_chats>\n\n${text}` : text }] });

  // "Still correct?" must be re-checked against fresh sources, so force a search on the first step.
  const force = RECHECK.test(text);
  let answer = '';
  const sources = new Map<string, string>();
  emit({ type: 'status', text: 'Thinking…' });

  for (let hop = 0; hop < 4; hop++) {
    const stream = await ai.models.generateContentStream({
      model: MODEL, contents,
      config: {
        systemInstruction: system(now, tz), tools, maxOutputTokens: 2500, abortSignal: signal,
        ...(hop === 0 && force ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['web_search'] } } } : {}),
      },
    });
    const parts: any[] = [];
    const calls: any[] = [];
    for await (const chunk of stream) {
      for (const p of chunk.candidates?.[0]?.content?.parts ?? []) {
        parts.push(p);
        if (p.functionCall) calls.push(p.functionCall);
        else if (p.text && !p.thought) { answer += p.text; emit({ type: 'text', text: p.text }); }
      }
    }
    if (!calls.length) break;

    contents.push({ role: 'model', parts });
    const responses = await Promise.all(calls.map(async (c) => {
      emit({ type: 'status', text: `Searching: ${c.args?.query}` });
      const out: any = await webSearch(c.args ?? {});
      for (const r of out.results ?? []) if (r.url) sources.set(r.url, r.title || r.url);
      return { functionResponse: { name: c.name, response: out } };
    }));
    contents.push({ role: 'user', parts: responses });
  }

  const list = [...sources].map(([url, title]) => ({ url, title })).slice(0, 8);
  if (list.length) emit({ type: 'sources', sources: list });
  save(conv, text, answer, list, now.getTime(), Date.now());
  emit({ type: 'done' });
}
