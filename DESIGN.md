# Design

**Run:** `cp .env.example .env` (add free `GEMINI_API_KEY` and `TAVILY_API_KEY`), `npm install`, `npm run dev`, open http://localhost:3000. `npm test` checks date resolution.

## How it works
A small tool loop: Gemini with one function tool, `web_search`, backed by Tavily. Both are config, so swapping model or search provider only touches `src/agent.ts`. The request path is:

1. **Recall (code, before the model).** The server resolves any date in the message ("3 November", "last Tuesday", "on Monday") in the user's timezone, pulls the turns recorded on that day from SQLite, and injects them with timestamps and age ("7 days ago"). If no date is found but the message points to the past ("we shortlisted", "still correct?"), it falls back to SQLite FTS5 keyword search. If nothing exists for a date, the model is told explicitly there is no record.
2. **Answer.** The model gets the current date and timezone, the last 10 turns of this chat, and the recalled turns. It searches only for things that can change, and, for "has anything changed since?", re-checks the claims in the old answer and reports only changes a source supports.
3. **Stream and store.** Tokens and search status stream to the browser over SSE. After the answer, both turns are saved with timestamps and cited sources.

## Why this way
- **Memory is not a tool.** The brief gives the agent one tool. Recall that depends on dates is deterministic, so doing it in code is faster (no extra model round trip), cheaper, and cannot be forgotten or misused by the model.
- **Timestamps are the key.** The hard questions are all "then vs now". Every stored turn carries a time, so the model sees what it said and when, and can compare it with fresh search results.
- **Forced re-check.** If the message asks "still correct?" or "has it changed?", code forces a search on the first step, so the model cannot just agree with its old answer.
- **Honest gaps.** "Last Tuesday" is ambiguous on a Wednesday, so both candidate days are retrieved. Missing records are stated, not guessed.
- **Speed.** Streaming, no extra planner or verifier call, independent searches run in parallel and tool rounds are capped at 4. `MODEL` can be set to a flash-lite model for lower latency.
- **Source quality.** Search excludes social, video and forum sites, and the prompt tells the model to call rumour-only figures unconfirmed.
- **Small surface.** A few small files in `src/`, one SQLite file, no vector DB, no framework.

## Considered and rejected
- Gemini's built-in Google Search grounding: simpler, but it returned HTTP 429 on a free key and gives less control. My own search step controls the query, the date filter and the sources shown.
- A `recall_memory` tool for the model: adds a round trip and a failure mode.
- Embeddings and a vector store: dates and keywords cover the real questions at this scale.
- Planner/critic multi-agent loops: slower, and a good prompt plus real search results does the work.
- Summarising old chats into notes: loses the exact wording and date that "what did I ask?" needs.

## Limits
Tested by hand on free Gemini and Tavily keys; there is no automated eval yet, and answer quality depends on the model and on Tavily's snippets. Free-tier quotas are small. Single user, no auth. Day windows use a fixed UTC offset, so a DST change inside the window is off by an hour.

## With another week
1. An eval set from the three example question types, scored for correctness and latency, to tune the prompt, model and search settings.
2. Re-run the original search queries stored with each answer and diff the results, instead of relying on the model to re-derive them.
3. Show a "price as of" date per claim and a compact change summary.
4. Rank recall by relevance, not just date, and handle ranges ("last week").
5. Per-user storage and auth, and fall back to a second provider on quota errors.
