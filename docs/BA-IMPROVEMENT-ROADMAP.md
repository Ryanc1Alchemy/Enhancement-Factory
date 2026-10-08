# BA Improvement Roadmap

This document tracks planned improvements to the GW Enhancement Agent — both
internal engineering housekeeping and user-facing improvements for the
Business Analyst (BA) workflow. Check items off as they're completed and
commit the update.

---

## Engineering / Infra To-Dos

- [x] Diagnose "Save unavailable (no DB)" message — confirmed this is expected
  graceful-degradation behavior when `DATABASE_URL` is not set locally, not a bug
- [x] Separate Alchemy branding changes from in-progress save/resume feature work
- [x] Shelve save/resume WIP via `git stash` (`stash@{0}` — "save-resume feature WIP (shelved)")
- [x] Create and push `feature/alchemy-branding` branch to Bitbucket
- [x] Verify `.env` is gitignored
- [ ] Decide on `DATABASE_URL` path — provision a Neon Postgres instance, or
  point to a local Postgres — so save/resume can be tested end-to-end
- [ ] Move the stashed save/resume WIP onto its own branch
  (e.g. `feature/save-resume-runs`) once the DB decision is made
- [ ] Open a PR for `feature/alchemy-branding` → `master` on Bitbucket for review

---

## BA Experience Improvements

Context: this app helps BAs work through a gated process to produce a Jira
ticket. The improvements below originated from two concrete BA pain points:

> "What if the user wanted to select a certain project from the beginning?"
>
> "What if you were working through different stages on the app and needed
> some verification from another person but it was scheduled a few days
> ahead — is there any way we can save this and continue where we left off?"

### 1. Project Selection at Intake
Add a "Select Project" step before Gate 1 so the BA can scope the run (e.g.
which Guidewire line of business / project) from the start, rather than the
system inferring context later from uploaded artifacts. Benefits:
- Clearer run context from the very first screen
- Enables project-specific defaults (templates, skills matrix, data
  dictionary) to be loaded immediately
- Reduces back-and-forth corrections later in the flow

### 2. Save & Resume a Run
Persist run state (current gate, artifacts, conversation history) so a BA can
leave mid-flow — e.g. while waiting on SME/architect sign-off — and resume
exactly where they left off, even days later. Requires:
- A `DATABASE_URL`-backed persistence layer (see Engineering To-Dos above)
- A "My Runs" / "Saved Runs" list view so BAs can find and reopen
  in-progress tickets
- Clear UI messaging when a run is paused vs. actively saved

### 3. Pending External Verification State
Add an explicit "Pending Review" status per gate so a run can be parked while
waiting on a third party (architect, lead BA, etc.), with:
- A visible status badge distinguishing "pending review" from "in progress"
- Optional reminder/notification when the wait exceeds a threshold
- A record of who the run is waiting on and why

### 4. Gate Navigation Flexibility
Allow BAs to jump back to a previous gate to tweak an earlier artifact
without losing downstream work already generated in later gates. Currently
gates likely must be progressed strictly forward — revisiting could trigger
smarter diffing/regeneration of only affected downstream artifacts.

### 5. Inline Validation Before Advancing Gates
Add lightweight validation/confirmation checks before a BA advances to the
next gate, so missing or inconsistent information is caught early rather
than surfacing as a problem several gates later.

### 6. Collaboration & Review
- Allow comments/annotations on individual artifacts so reviewers can leave
  feedback without directly editing the BA's work
- Consider a shareable, read-only link per run so non-BA stakeholders
  (architects, QA, product) can review progress asynchronously

---

## Prioritization Notes

Items 2 and 3 (Save & Resume, Pending Verification) directly address the
two pain points raised and are likely the highest-value next steps once the
database decision is made. Item 1 (Project Selection) is a relatively
low-effort, high-clarity improvement that could be tackled independently and
soon. Items 4–6 are valuable but lower urgency and can be sequenced after the
above.
