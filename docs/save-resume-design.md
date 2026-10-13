# Save & Resume Runs — Design

Branch: `feature/save-resume-runs` (from `master`)
Status: implemented on `feature/save-resume-runs`

## Goal

A BA can leave a run part-way through — for example while waiting days for
an architect's sign-off on the design note — and reopen it later exactly
where they left off: same gate, same content, same project grounding.

## Principle: the gates do not change

Save & resume is a layer *around* the gates, not a change *to* them.

- **Save** takes a snapshot of the run's state after a gate settles. It is a
  side effect: a failed save never blocks or alters a gate.
- **Resume** loads a snapshot back into the same state the gates already use.
  From there the existing actions (`acceptGate`, `rejectGate`,
  `editAndAcceptGate`, `recomputeEstimate`) run unchanged.
- Untouched: `api/agent.js`, `api/estimate.js`, the prompts, the schemas,
  gate order, and how each gate calls the agent.
- **Proof:** a test shows that a run saved after Gate 3 and resumed sends
  *byte-identical* requests to the agent for Gates 4–6 as the same run done
  without a break (see Tests).

## What exists today

| Piece | State |
| --- | --- |
| `api/runs.js` save / get / list | Works when `DATABASE_URL` is set; creates the `agent_runs` table itself |
| Auto-save in `useAgentRun.js` | Saves after each approval and after Jira |
| Schema versioning | `schema_version` column; older runs flagged `is_pre_reorder` |
| Resume / list screen | Missing — nothing calls `api.runs.get` or `api.runs.list` |

### Gaps that stop resume working properly

1. **The gate under review is not saved.** Only `acceptedArtifacts` is
   stored, so the gate the BA is waiting on sign-off for — the reason for
   saving — is lost.
2. **Project grounding is lost.** Attached Guidewire files and BA notes
   (`guidewireBundle`) are not saved, so a resumed run's later gates lose
   the data-dictionary, PCF and rule context.
3. **Gate status and history of changes are lost.** `gateStates` and
   `previousArtifacts` (used for the diff view) are not saved.
4. **The list call is missing the auth header.** `src/lib/api.js`
   `runs.list()` omits `runsAuthHeaders()`, so it fails (401) once
   `RUNS_API_SECRET` is set.
5. **Two tabs can overwrite each other.** Saves are last-write-wins with no
   check.

## Design

### 1. Run snapshot (new, pure, tested)

New file `src/lib/runSnapshot.js`, with no React and no network:

- `toSnapshot(state)` returns a plain JSON object with:
  `snapshot_version`, `request`, `gateStates`, `artifacts` (proposed and
  accepted), `acceptedArtifacts`, `previousArtifacts`, `conversation`,
  `jiraResult`, `bundleSummary`, `bundleDescription`.
  It deliberately excludes `busy`, `error` and the raw `guidewireBundle`.
- `fromSnapshot(snapshot)` returns state ready for the hook, after
  validating the version and normalising any in-flight state (see Edge cases).
- `snapshotSize(snapshot)` returns the byte size, used to enforce the size limit.

### 2. Project grounding: save the summary, not the files

The agent never receives the raw files. Every advance call sends
`buildBundleSummaryForRequest(bundle, request)`, a text digest capped per
area (around 12,000 characters each). For a given run that digest is the same
at every gate.

- At run start, compute the digest once and keep it in state as
  `bundleSummary` (plus the human-readable `describeBundle` lines).
- Save the digest, not the parsed bundle. The parsed bundle can be large and
  holds internal structures that don't serialise cleanly. Vercel also
  rejects request bodies over 4.5 MB.
- After resume, the gates use the saved digest. Advancing gates is identical
  to an uninterrupted run.
- **One known difference:** a *rejection with feedback* normally rebuilds the
  digest using the request text plus the feedback, which can pull in
  different excerpts. After resume without the files it falls back to the
  saved digest. The resume screen offers "Re-attach project files" to restore
  full fidelity, and shows a note when files aren't re-attached.

Code change, kept small: one helper in `useAgentRun.js`,
`groundingFor(state, text)`, which uses the live bundle when present and
otherwise the saved digest. It replaces the three inline
`buildBundleSummaryForRequest(...)` calls. The value sent for advance calls
does not change.

### 3. Database (additive only)

The existing `agent_runs` table stays. Columns are added with
`ADD COLUMN IF NOT EXISTS` in `ensureSchema`, following the existing pattern:

| Column | Type | Purpose |
| --- | --- | --- |
| `state` | `JSONB` | The full snapshot (section 1) |
| `title` | `TEXT` | Short name shown in the list (defaults to the request) |
| `revision` | `INT NOT NULL DEFAULT 0` | Optimistic locking (section 5) |
| `waiting_on` | `TEXT` | Who sign-off is waiting on (free text until sign-in exists) |
| `waiting_reason` | `TEXT` | Why the run is parked |
| `waiting_since` | `TIMESTAMPTZ` | When it was parked |

- Existing columns keep being written (`artifacts` = accepted artifacts,
  `current_gate`, `status`), so anything that reads them today still works.
- `status` gains the value `waiting_review`. The other values are unchanged.
- Bump `SCHEMA_VERSION` / `CURRENT_SCHEMA_VERSION` from 2 to 3. Rows at
  version 2 have no `state`. They open read-only, rebuilt from `artifacts` as
  "approved gates only", with a notice.

### 4. API (`api/runs.js`)

- `save`: accepts `state`, `title`, `waiting_*` and `revision`. It rejects
  bodies over 1 MB with a clear error.
- `get`: returns `state` when present.
- `list`: adds `title`, `status`, `waiting_on` and `waiting_since`. Optional
  filter `?status=waiting_review`.
- No new endpoint. `/api/agent` and `/api/estimate` are untouched.

### 5. Saving rules (`useAgentRun.js`)

- **When:** after a gate settles, meaning a gate becomes proposed or accepted,
  a rejection completes, an edit is accepted, the grade is recomputed, or
  Jira is committed. Never while `busy` is true. That way an in-flight agent
  call is never captured.
- **Debounced:** wait 1 second, so a burst of changes produces one save.
- **Non-blocking and non-fatal:** a failed save shows "Not saved — retrying"
  but the gate carries on (the existing behaviour).
- **Conflict check:** each save sends the `revision` it last loaded. The
  server updates only if it matches, then increments it. On a mismatch the
  UI says "This run was changed in another tab — reload it" and stops
  auto-saving that tab.
- **Explicit "Park for review":** a button on the current gate saves with
  `status = waiting_review` plus who and why. Resuming clears it.

### 6. Screens

All of these are hidden when the database isn't configured, so the app
behaves exactly as today without one.

- **Saved runs panel** on the start screen: title, current gate,
  status badge (In progress / Waiting on review · N days / Ticket raised),
  last updated, and an **Open** button. Waiting runs sort to the top.
- **Run header:** "Saved 10:42" or "Not saved" indicator, plus **Park for
  review**.
- **Resume notice:** "Resumed at Gate 3 — Design Note. Project files are not
  re-attached; later gates use the saved project summary. [Re-attach files]".

New files: `src/components/SavedRuns.jsx`, `src/components/ParkModal.jsx`.
Small edits: `ArtifactStack.jsx` (render the panel and header) and
`src/lib/api.js` (list auth fix, revision and waiting fields).

## Edge cases

| Case | Behaviour |
| --- | --- |
| Saved while a gate was mid-call | Cannot happen: saves skip `busy`. Defensive: on resume a `regenerating` gate with an artifact becomes `proposed`; without one it becomes `pending` with a **Run this gate** button that calls the same advance call |
| Pre-reorder run (no or old `schema_version`) | Opens read-only with the existing `is_pre_reorder` warning |
| Version 2 run (no `state`) | Opens read-only: approved gates shown, "resume not available for runs saved before this feature" |
| Jira already raised | Opens read-only with the ticket key |
| Snapshot over 1 MB | Not saved. The user is told why (usually very long BA notes). The gates are unaffected |
| Database down mid-session | Same as no database: "Not saved", and the run continues in memory |
| Open in two tabs | The revision check stops the second tab overwriting the first |

## Security

- Saved runs hold client requests and BA notes. Set `RUNS_API_SECRET` and
  `VITE_RUNS_API_SECRET` in every deployed environment before turning this on.
- There's no sign-in yet, so everyone with the app can see every saved run.
  `waiting_on` / `updated_by` are free text for now. Per-user ownership and
  share links wait for sign-in (roadmap item 7).

## Database setup

- `@neondatabase/serverless` (`neon()`) runs SQL over HTTP to Neon and
  does **not** connect to a plain local Postgres.
- **Recommended:** a free Neon project with a `dev` branch for local work and
  the main branch for Vercel. Put each one's `DATABASE_URL` in `.env` and in
  Vercel.
- **Optional:** Neon Local, a Docker proxy that also lets the HTTP driver run
  against a Neon branch from localhost. It still uses Neon cloud underneath.
- Tests never touch a real database: `api/runs.js` is tested with a fake
  `sql` function.

## Tests

| Test file | What it proves |
| --- | --- |
| `src/lib/runSnapshot.test.js` | Snapshot round-trip at every gate position; `busy` and `error` excluded; in-flight states normalised; size limit enforced |
| `src/lib/resumeEquivalence.test.js` | **The gates are unaffected:** run A goes through Gates 1–6 straight; run B is saved after Gate 3, restored and continued. The agent request bodies for Gates 4–6 are identical, including `prior_artifacts` and the grounding text |
| `api/runs.test.js` | Additive migration is idempotent; save/get/list with `state`; revision conflict returns 409; list honours `RUNS_API_SECRET`; version 2 rows open read-only |
| `src/components/SavedRuns.test.jsx` | List renders statuses and waiting days; hidden when the database is unavailable |
| Existing 68 tests | Must pass unchanged |

Plus a browser check with the agent faked: start, approve two gates, park
at Gate 3, reload, reopen, approve Gate 3, and confirm Gate 4 runs with the
same grounding.

## Build order and sizes

| Step | Work | Days |
| --- | --- | --- |
| 1 | List auth fix + `runSnapshot.js` + tests | 1 |
| 2 | `groundingFor` helper + resume-equivalence test | 0.5 |
| 3 | `api/runs.js` columns, revision check, size limit + tests | 1 |
| 4 | Hook: `resumeRun`, debounced save, conflict handling | 1 |
| 5 | Saved runs panel, Park for review, resume notice | 1.5 |
| 6 | Neon dev branch, browser check, README update | 0.5 |
| | **Total** | **≈ 5.5** |

## Before starting the branch

- Merge `feature/estimator-calibration-v2` and `feature/alchemy-branding`
  into `master` first. Both touch files this feature edits
  (`useAgentRun.js`, `api.js`, styles), so branching from an out-of-date
  `master` means merge conflicts later.
- The roadmap mentions a stashed save/resume work-in-progress. The current
  working copy's two stashes contain estimator work only, so check for that
  stash elsewhere before starting from scratch.

## Implementation notes (differences from the proposal)

- **Opening a run never saves it.** Without this, merely viewing a run in a
  second tab would make the first tab out of date.
- **Out-of-date tabs are caught on focus.** When a tab regains focus it checks
  the saved revision. If the run has been saved elsewhere, the gate buttons are
  disabled and **Reload this run** is offered, so no agent call is wasted.
- **The schema version moved to 3, but the pre-reorder boundary stays at 2**
  (`REORDER_SCHEMA_VERSION`), so existing version 2 runs are not misflagged as
  pre-reorder.
- **Once a run has started, the request box is replaced** by the request text
  and the save/park bar. A resumed run has no typed text to show in the box.
- **New hook actions:** `resumeRun`, `parkRun`, `unparkRun`, `reattachFiles`,
  `runPendingGate`, `dismissResumeNotes`. The existing gate actions are unchanged.

## Sources

- [Neon Local — Neon docs](https://neon.com/docs/local/neon-local)
- [Local development with Neon](https://neon.com/guides/local-development-with-neon)
- [How to bypass the Vercel body size limit (4.5 MB)](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
