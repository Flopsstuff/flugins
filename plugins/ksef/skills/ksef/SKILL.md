---
name: ksef
description: >-
  Use when the user wants to work with the Polish National e-Invoice System
  (KSeF): send an invoice (faktura), find/query/download invoices, download a
  UPO receipt, check invoice status, set up or install the ksef tool, log in to
  KSeF, or fix KSeF errors (401 unauthorized, 440 duplicate invoice). Triggers:
  KSeF, faktura, e-faktura, e-invoice, FA3, UPO, NIP, KSeF token, invoice
  send/query, "wyślij fakturę", "pobierz fakturę".
disable-model-invocation: false
user-invocable: true
allowed-tools: >-
  Read Write Edit AskUserQuestion
  Bash(ksef --help)
  Bash(ksef invoice:*) Bash(ksef session:*)
  Bash(ksef limits:*) Bash(ksef lighthouse:*) Bash(ksef peppol:*) Bash(ksef qr:*) Bash(ksef doctor:*)
  Bash(ksef config show:*) Bash(ksef config set:*)
  Bash(ksef auth login:*) Bash(ksef auth whoami:*) Bash(ksef auth status:*) Bash(ksef auth refresh:*) Bash(ksef auth challenge:*)
  Bash(ksef token list:*) Bash(ksef token get:*)
  Bash(ksef cert generate:*) Bash(ksef cert status:*) Bash(ksef cert list:*) Bash(ksef cert limits:*) Bash(ksef cert enrollment-data:*) Bash(ksef cert retrieve:*) Bash(ksef cert enroll:*)
  Bash(ksef permission search:*) Bash(ksef permission status:*) Bash(ksef permission attachment-status:*)
  Bash(ksef offline generate:*) Bash(ksef offline list:*) Bash(ksef offline status:*) Bash(ksef offline submit:*) Bash(ksef offline correct:*)
  Bash(command -v:*) Bash(node --version) Bash(hash -r)
  Bash(echo:*) Bash(head:*)
  Bash(npm install:*) Bash(npm config:*) Bash(npm update:*)
  Bash(pnpm add:*) Bash(bun add:*) Bash(yarn global:*)
  Bash(brew install:*) Bash(winget install:*)
  Bash(mkdir:*) Bash(umask:*) Bash(printf:*) Bash(chmod:*) Bash(cat:*)
---

# KSeF for regular users, via the ksef CLI

You operate the Polish National e-Invoice System (KSeF) on the user's behalf using the
`ksef` CLI (npm package `ksef-client-ts`). Assume the user is NOT a developer: explain
in the user's language what you are doing at each step, what each term means the first
time it appears (NIP = tax ID, UPO = official receipt confirming KSeF accepted the
invoice, P_2 = the invoice number). One step at a time — never dump a wall of commands
on the user.

This skill runs both ways: automatically when the user's request is KSeF-related, and
manually when the user types `/ksef`. On a bare `/ksef` with no specific task, run the
Preflight below and either continue onboarding (if not set up) or ask what they want to
do (send an invoice, find/download invoices, download a UPO).

## Ground rules

1. **Production first.** The CLI defaults to the `prod` environment and so does this
   skill. Never use `--env demo` or `--env test` unless the user explicitly asks for a
   sandbox (a demo needs its own separate token). You may mention that a demo
   environment exists — do not steer the user there.
2. **Handle the token as a secret.** During onboarding the user types it into the chat
   once (an accepted tradeoff for simplicity) — after that, never re-print it, never
   echo it back, and reference it only via `"$(cat ~/.ksef/token.txt)"`. Once logged in
   you never need the raw value again (the CLI re-logins from `~/.ksef/credentials.json`).
3. **No builds, no repo checkouts.** The CLI is installed from npm only. If it is
   missing, run onboarding — do not clone or build anything.
4. Nested `--help` is broken: `ksef invoice send --help` prints the ROOT help. Flags
   for every subcommand are in `${CLAUDE_SKILL_DIR}/docs/reference.md`.
5. Add `--json` to commands whose output you parse; show the user friendly summaries,
   not raw JSON.
6. **When unsure about a command, flag, or value, don't guess — look it up first.**
   In order: `ksef --help` and `ksef <group> --help` (e.g. `ksef invoice --help`) —
   these work and list the groups/subcommands; then `${CLAUDE_SKILL_DIR}/docs/reference.md`
   for exact flags. Only subcommand-level `--help` is broken (rule 4), so don't rely on
   it for flags. Never invent a flag that isn't in the reference or group help.
7. **Confirm before destructive or irreversible actions.** Explain the consequence in
   plain language and get an explicit "yes" first — never fire these off on your own:
   revoking the login token (`auth revoke-self-token`) or any token (`token revoke`),
   revoking a certificate (`cert revoke`), granting/revoking permissions
   (`permission grant` / `permission revoke`), deleting stored offline invoices
   (`offline delete`), resetting the config (`config reset`), logging out
   (`auth logout`), or generating a new token (`token generate`). These are deliberately
   NOT pre-approved, so they also raise a permission prompt — but explain before you
   trigger it, don't just let the prompt appear. Separately, `invoice send` submits a
   **real, legally binding invoice** to the tax authority: show the user the invoice
   number and key amounts and confirm before sending on production.

Need the NIP? Read it from `ksef config show` (onboarding saves it there), or ask the
user — a NIP is not a secret.

## Preflight — run at every activation

```bash
command -v ksef >/dev/null 2>&1 || echo "NOT INSTALLED"
ksef auth whoami --json || echo "NOT AUTHENTICATED"
```

| Result | What to do |
|---|---|
| `ksef` not found | Read `${CLAUDE_SKILL_DIR}/docs/onboarding.md` and run it from Stage 1 (install). |
| Installed, but `whoami` fails / exits 1 | Onboarding from Stage 2 (get token → ask for NIP + token → login). |
| `whoami` OK but environment is not PROD | Tell the user which environment they are on. If they did not intend a sandbox: `ksef config set --env prod` (this clears the session) and re-login via onboarding Stage 4. |
| `whoami` OK on PROD | Proceed with the user's task. |

After onboarding completes, return to whatever the user originally asked for.

## Send an invoice

If the user has data but no XML, build the XML first — never hand-write XML:

```bash
ksef invoice build --template FA3 > invoice.json   # skeleton; fill it from the user's data
ksef invoice build invoice.json --schema FA3 -o invoice.xml --validate
```

Then send and confirm:

```bash
ksef session open --formCode FA3        # 1. open an online session
ksef invoice send invoice.xml           # 2. send
ksef session invoices --json            # 3. check status — look for errors/duplicates
ksef session upo <sessionRef> --ksefNumber <nr> -o upo.xml   # 4. official receipt
```

- Tell the user their invoice's KSeF number and offer to save the UPO — it is the
  legal proof of delivery.
- The invoice number (`P_2`) must be unique. Error **440 (Duplikat faktury)** means
  that number was already used — fix the number, don't just retry.
- A whole directory of XMLs can be sent in one go: `ksef invoice send <dir>` (batch
  session is handled automatically; no `session open` needed).

## Find / download invoices

```bash
ksef invoice query --from 2026-06-01 --json      # --from is REQUIRED; add --to, --sellerNip, --buyerNip...
ksef invoice get <ksefNumber> -o invoice.xml     # download one invoice by its KSeF number
```

- **The date range is capped at 3 months.** KSeF rejects a `--from`/`--to` span longer
  than 3 months (this also applies to `export` and `export-incremental`). If the user
  wants a longer period, split it into consecutive ≤3-month windows and run the query
  per window. When `--to` is omitted it defaults to now, so `--from` must be within the
  last 3 months.

For a large or recurring download, use async export:
`ksef invoice export --from ...` → `ksef invoice export-status <ref>`; for periodic
syncs `ksef invoice export-incremental --from ...` (remembers where it stopped).

## Troubleshooting

| What the user sees | What it means → what you do |
|---|---|
| 401 / session expired | Re-run the command once (the CLI re-logins automatically from stored credentials); if it still fails → onboarding Stage 4. |
| Error 440 Duplikat faktury | Invoice number already used — change `P_2`. |
| "Run `ksef session open` first" | Sending a single file needs an open session — open one, resend. |
| "Run `ksef setup`" | No stored credentials → onboarding Stage 2. |
| Empty query results the user did not expect | Check `whoami`: wrong environment or wrong NIP context. |
| 429 | KSeF rate limit — wait and retry; show `ksef limits rate` if it repeats. |

## Full reference

`${CLAUDE_SKILL_DIR}/docs/reference.md` — every command group with all flags, storage
layout (`~/.ksef/`), exit codes, and known places where the CLI differs from its own
docs. Trust the reference over `--help` and over project docs. Its top section links the
**official documentation** (ksef-client-ts docs/GitHub/npm and the official KSeF portal,
CIRFMF/ksef-docs, and live OpenAPI spec) — open those when the reference isn't enough.
