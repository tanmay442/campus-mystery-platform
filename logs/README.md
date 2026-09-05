# Session Logs

Running record of every agentic build session on this repo. This directory is
committed, so any future session (fresh agent, fresh clone) can reconstruct
project state without asking the user to repeat context.

## Layout

```text
logs/
  README.md                        this file — conventions for reading/writing logs
  vision/                          immutable product reference, copied once
    campus-mystery-platform-prd.md full PRD, byte-identical to the author's copy
  YYYY-MM-DD-session-NN-<slug>/    one directory per agentic session
    report.md                      what that session did (see format below)
```

## Session protocol (mandatory for every agent session)

1. Session start: read `logs/vision/campus-mystery-platform-prd.md`,
   `docs/phase-1.md`, and the `report.md` of the highest-numbered session
   directory. That is the current state. Trust it over pre-trained knowledge.
2. Do the work on `main`, one focused step at a time.
3. Session end: create the next `YYYY-MM-DD-session-NN-<slug>/` directory and
   write `report.md` in the format below. Commit and push it with the work.

## report.md format

- Goal — one sentence: what this session set out to do.
- Work done — files/modules created or changed, with one-line purpose each.
- Decisions — stack, schema, version, or behavior choices and why.
- Verification — exact commands run and their results (typecheck, tests,
  builds, migrations). Note anything NOT verified.
- Known gaps / debt — what is stubbed, placeholder, or needs credentials.
- Next session — the concrete starting task and which files it touches.

## Numbering

Sessions increment `NN` (`01`, `02`, …) regardless of date. Slugs are short
(`foundation`, `auth-sessions`, `teams`). Never edit a past session's report;
correct the record in the newest one.
