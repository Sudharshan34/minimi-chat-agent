import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const model = process.env.MODEL || 'gemini-3.1-flash-lite';
try {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const r = await ai.models.generateContent({ model, contents: 'Reply with the single word: ok' });
  console.log(`Gemini (${model}): OK ->`, r.text?.trim());
} catch (e: any) {
  console.log(`Gemini (${model}): FAILED ->`, String(e?.message ?? e).slice(0, 200));
}
try {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query: 'latest iPhone price India', max_results: 2 }),
  });
  const j: any = await r.json();
  console.log(r.ok ? `Tavily: OK -> ${j.results?.length} results` : `Tavily: FAILED (${r.status}) -> ${JSON.stringify(j).slice(0, 200)}`);
} catch (e: any) {
  console.log('Tavily: FAILED ->', e?.message ?? e);
}
