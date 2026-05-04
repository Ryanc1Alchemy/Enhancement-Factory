# Enhancement Factory v2 — Agentic

> NTT DATA Guidewire Practice  ·  Presales / client-facing demo asset

From a one-line client request to a sized, scoped, ticketed Guidewire backlog item — with a human approving every step.

---

## What this is

A six-gate agentic workflow that converts vague enhancement requests (e.g. *"add a discount for hybrid vehicles"*) into a fully-decomposed backlog item: classification → scope → design → estimate → acceptance criteria → real Jira ticket.

The demo's value proposition is **governed AI applied to Guidewire delivery** — not autonomy. A human reviews and approves every artifact the agent produces.

---

## Quick start

### 1. Push to GitHub

```bash
cd gw-enhancement-agent
git init
git add .
git commit -m "Enhancement Factory v2 — initial commit"
git remote add origin https://github.com/YOUR_ORG/gw-enhancement-agent.git
git push -u origin main
```

### 2. Deploy to Vercel

- Create a new Vercel project, import the GitHub repo.
- Vercel auto-detects Vite. No additional build configuration needed.

### 3. Set environment variables in Vercel

Settings → Environment Variables. Add:

| Variable | Required for | Example |
|---|---|---|
| `ANTHROPIC_API_KEY` | All gates (1-6) | `sk-ant-...` |
| `DATABASE_URL` | Save/resume runs (optional) | `postgres://...neon.tech/...?sslmode=require` |
| `JIRA_BASE_URL` | Real Jira tickets at gate 6 | `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | Real Jira tickets at gate 6 | `bot@nttdata.com` |
| `JIRA_API_TOKEN` | Real Jira tickets at gate 6 | `ATATT...` |
| `JIRA_PROJECT_KEY` | Real Jira tickets at gate 6 | `GWDEMO` |

**Graceful degradation**: only `ANTHROPIC_API_KEY` is strictly required. Without `DATABASE_URL`, runs aren't persisted but the agent works. Without the JIRA vars, gate 6 produces a simulated payload (the demo still ends with a complete ticket spec).

### 4. Initialise the database (if using DATABASE_URL)

The schema is created automatically on first request. If you want to pre-create it:

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id        UUID PRIMARY KEY,
  request       TEXT NOT NULL,
  current_gate  INT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'in_progress',
  artifacts     JSONB NOT NULL DEFAULT '{}'::jsonb,
  history       JSONB NOT NULL DEFAULT '[]'::jsonb,
  jira_ticket   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5. Open the deployed URL

Pick a scenario, watch the agent work through six gates, approve each one, end with a real Jira ticket.

---

## Demo runbook

### Pre-demo (5 minutes before the meeting)

1. Open the deployed URL in a fresh browser window.
2. Run **Hybrid Vehicle Discount** end-to-end as a warm-up — this primes the Vercel function (avoids first-call latency in front of the client) and confirms Jira is wired correctly.
3. Click "Start over". You're ready.

### In the meeting (10-15 minutes per scenario)

**Frame**: *"NTT DATA's delivery centre uses Claude to decompose enhancement requests into ticketed backlog items. The agent proposes — your delivery lead approves every step."*

**Run scenario**:

1. Click a scenario chip → input pre-fills.
2. Click **Run agent**.
3. **Gate 1 lands**. The wow moment: the agent says what it's *assuming* and what it *cannot decide for the human*. Read the ambiguities aloud. *"Notice the agent didn't guess — it surfaced these for you."*
4. Accept gate 1.
5. **Gates 2-3** flow naturally. Pause briefly on gate 3 to point at a specific Guidewire entity / typelist / PCF the agent named.
6. **Gate 4 estimate**. Second wow moment: hours by role and location, with a confidence band. *"This uses our AMS Engagement Estimator model. Calibrated against real NTT DATA delivery data."*
7. **Gate 5** acceptance criteria — read one Gherkin scenario aloud.
8. **Gate 6** Jira draft → click **Approve & Raise Jira ticket**. Real ticket created. Click the link to open it in Jira.

**Closing line**: *"Three minutes ago, you gave us a one-line request. You're now looking at a fully-scoped, sized, ticketed backlog item — with full traceability of what was decided at each step."*

### What if a client asks…

- **"Is the agent reading our codebase?"** No — the agent uses generic Guidewire domain knowledge plus our house-style patterns. Reading a real codebase is on the v2 roadmap and would require an integration assessment.
- **"What if the agent gets it wrong?"** That's why every gate has a human approval. Reject with feedback, the agent regenerates incorporating your input. We don't ship the agent's first attempt — we ship the version your delivery lead approved.
- **"What about our data?"** No client data is used to train the model. The request you see is what's sent. You can run this on a private Vercel deployment with your own Anthropic API key.

### What to do if something breaks

| Symptom | Likely cause | Action |
|---|---|---|
| 504 timeout on a gate | Vercel cold start | Refresh, try again. Demo will work. |
| "ANTHROPIC_API_KEY is not set" | Env var missing | Set in Vercel → redeploy |
| Gate 6 says "simulated" | Jira env vars missing | Either set them, or proceed with the simulated ticket — the payload is still complete |
| Gate 6 says "Jira returned 400" | Component or custom field mismatch in your Jira project | The fallback retry strips components & story points. Check the Jira project has the standard issue types. |
| Empty pane / hung spinner | API error | Check browser DevTools console, share with build owner |

---

## Architecture

### Stack

- **Frontend**: Vite + React 18 (no CRA, avoids `no-unused-vars` build-break issue)
- **Backend**: Vercel serverless functions (`api/agent.js`, `api/estimate.js`, `api/jira.js`, `api/runs.js`)
- **LLM**: Claude Sonnet via Anthropic SDK, routed through `/api/agent` (no direct browser → Anthropic call; CORS-clean)
- **DB**: Neon serverless Postgres (optional — for save/resume)
- **Brand**: NTT DATA Blue `#003087`, Red `#E4002B`

### The agent loop

The frontend drives the loop. Each user approval is a fresh API call to `/api/agent`. The backend exposes only the active gate's tool to Claude — schema-level enforcement of single-artifact-per-turn.

```
Frontend ──► /api/agent (gate=N, prior_artifacts) ──► Claude (tool=GATE_N_TOOL)
                                                           │
                                                           ▼
                                                    structured artifact
                                                           │
                  ┌────────────────────────────────────────┘
                  ▼
            Persist to Neon  ──►  Return to frontend  ──►  Render card
                                                           ▼
                                                     User approves
                                                           │
                                                           ▼
                                                  (back to top, gate=N+1)
```

### Why no agent framework

For 6 gates and 7 tools, a framework adds more weight than it saves. Direct Anthropic tool-use API gives full control of prompts, full control of UX, no dependency surprises on Vercel cold starts.

---

## File map

```
gw-enhancement-agent/
├── api/
│   ├── _lib/
│   │   ├── parseBody.js              Manual stream parsing (Vercel quirk)
│   │   ├── db.js                     Neon client (lazy init)
│   │   ├── prompts/
│   │   │   ├── system.js             Master system prompt
│   │   │   └── gates.js              Per-gate user instructions
│   │   └── schemas.js                Tool schemas + GATE_TOOLS map
│   ├── agent.js                      Master orchestrator (Claude tool-use)
│   ├── estimate.js                   AMS estimator port (per-enhancement)
│   ├── jira.js                       Real Jira REST + simulation fallback
│   └── runs.js                       Save/load/list (Neon)
│
├── src/
│   ├── components/
│   │   ├── ArtifactCard.jsx          Per-gate card with state machine
│   │   ├── ArtifactStack.jsx         Right pane container
│   │   ├── ConversationPane.jsx      Left pane (reasoning log)
│   │   ├── EditModal.jsx             JSON editor (v1)
│   │   ├── RejectModal.jsx           Feedback input for regeneration
│   │   ├── RequestInput.jsx          Opening shot
│   │   └── artifactRenderers.jsx     Per-gate artifact rendering
│   ├── hooks/
│   │   └── useAgentRun.js            Main state machine
│   ├── lib/
│   │   ├── api.js                    Frontend API client
│   │   ├── gates.js                  Gate metadata + state enum
│   │   └── scenarios.js              Three pre-loaded demos
│   ├── styles/
│   │   ├── tokens.css                NTT brand tokens
│   │   └── components.css            All UI styles
│   ├── App.jsx                       Top-level shell
│   └── main.jsx                      React entry
│
├── public/favicon.svg
├── index.html
├── package.json
├── vercel.json
├── vite.config.js
├── .env.example
└── .gitignore
```

---

## Pre-loaded scenarios

| Scenario | LoB | Why |
|---|---|---|
| Hybrid Vehicle Discount | PolicyCenter / Personal Auto | Strongest opener. Touches typelists, rating, forms, UW rules. Ambiguities at gate 1 land in the room. |
| FNOL Automation Rule | ClaimCenter | Workflow rules, classification, assignment. Different shape from rating-heavy scenarios. |
| Dunning Policy Change | BillingCenter | Configuration change. Smaller estimate, faster walk-through. Closer or second scenario. |

---

## Customising for a specific client

### Change the Jira project

Update `JIRA_PROJECT_KEY` env var. The agent's components/labels do not need code changes.

### Use the client's Guidewire vocabulary

Edit `api/_lib/prompts/system.js`. The "House style" section is where to add client-specific entity names, naming conventions, or design patterns. Keep changes additive — the agent's core behaviour is locked.

### Change location split / role rates

Edit `api/estimate.js`:

- `LOCATION_SPLIT` — defaults to 15% Onsite / 70% Offshore India / 15% Nearshore.
- `BASE_HOURS` — base hours per role per change type.
- `COMPLEXITY_MULTIPLIERS` — simple/medium/complex multipliers.

### Change the story-point mapping

Edit the schema description in `api/_lib/schemas.js` (`produce_jira_payload` tool, `story_points` field). The agent infers points from gate 4 hours.

---

## Roadmap (v2)

Deferred from v1 by deliberate scope discipline:

- Multi-user approval workflow (BA approves 1-2, tech lead 3-4, etc.)
- PowerPoint export of the artifact stack
- "What if" forking — fork at any gate, compare scope/estimate variants
- RAG over NTT DATA design standards corpus (improves house-style fidelity)
- Regression eval suite (20 known requests, nightly drift detection)
- Full AMS Engagement Estimator (engagement-level sizing)
- Read-only integration with a sample Gosu repo on GitHub

---

## License

Internal NTT DATA asset. Not for external distribution.
