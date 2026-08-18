# KSeF onboarding — guided setup for a non-technical user

Follow this flow when the `ksef` CLI is missing or not authenticated. Work
conversationally, in the user's language: before each stage, tell the user in one or
two plain sentences what is about to happen and why. When onboarding finishes, return
to the user's original request.

Tell the user the plan up front: **1) install the tool → 2) get a KSeF token →
3) enter NIP + token → 4) log in → 5) verify.** Skip stages already done (e.g. CLI
installed → start at Stage 2).

## Stage 1 — install the CLI

Explain: "I'll install `ksef` — a small command-line program (the `ksef-client-ts`
package) that talks to the government KSeF API on your behalf."

1. Check Node.js: `node --version` — need **18+**.
   - Missing/too old → install per OS: macOS `brew install node` (or the nodejs.org
     installer), Windows `winget install OpenJS.NodeJS.LTS`, Linux — distro package or
     nvm. Run it for the user if the package manager is available; otherwise give the
     nodejs.org link and wait.
2. Install with whatever package manager the user has (try in this order):
   ```bash
   npm install -g ksef-client-ts        # default
   # or: pnpm add -g ksef-client-ts / bun add -g ksef-client-ts / yarn global add ksef-client-ts
   ```
   - `EACCES` on npm → do NOT reach for sudo; fix the prefix:
     `npm config set prefix ~/.npm-global`, add `~/.npm-global/bin` to PATH, re-run.
3. Verify: `command -v ksef && ksef --help | head -3`. If the shell can't see it yet,
   `hash -r` or check the global bin dir is on PATH.

## Stage 2 — explain the token and where to get it

Explain, in plain words:

- KSeF is Poland's national e-invoicing system; every business invoice goes through it.
- To let a program act for their company, KSeF issues a **token** — a long-lived access
  key tied to their company's **NIP** and to specific permissions. It is like a
  password: whoever holds it can issue invoices for the company.
- The token is generated **once, in the KSeF web portal**, and shown **only once** — it
  must be copied immediately.

Guide them through generating it (they do this in their browser; you cannot — it needs
their government identity login):

1. Open the production portal: **<https://ap.ksef.mf.gov.pl/web/>**
2. Log in with Profil Zaufany / mObywatel / qualified certificate.
3. Choose the company context (their NIP).
4. Find the tokens section ("Tokeny") → generate a new token.
5. Permissions to select: at minimum **issuing invoices** (Wystawianie faktur /
   InvoiceWrite) and **viewing invoices** (Przeglądanie/Dostęp do faktur / InvoiceRead).
6. Copy the token — the portal will not show it again.

If the user has no Polish company/NIP or only wants to try things out, and only then,
mention the **demo** sandbox (portal <https://ap-demo.ksef.mf.gov.pl/web/>; every
command would need `--env demo` with a demo-specific token). Otherwise stay on
production.

## Stage 3 — collect NIP and token, one step at a time

Ask with **plain chat messages, one value per turn** — do NOT use AskUserQuestion.
That tool is for choosing between options; for free text it forces a confusing "Other"
box (and errors out on empty options). A two-step conversational prompt gives the same
step-by-step wizard feel without any "Other".

Step 3a — ask for the NIP and **wait for the reply**:

> Шаг 1 из 2. Напишите ваш **NIP** — 10 цифр.

Step 3b — after they answer, ask for the token and **wait for the reply**:

> Шаг 2 из 2. Теперь вставьте **KSeF-токен**, который вы скопировали в портале.

(Phrase both in the user's language.) Once you have both values, save the token to a
per-OS location and log in (Stage 4). Where to save:

- macOS / Linux: `~/.ksef/token.txt`
- Windows: `%USERPROFILE%\.ksef\token.txt`

```bash
mkdir -p ~/.ksef
umask 077
printf '%s' '<TOKEN>' > ~/.ksef/token.txt        # <TOKEN> = the value the user sent in chat
chmod 600 ~/.ksef/token.txt
```

Do not echo the token back in any later message. Writing it via `printf` into the file
does not re-print it in the chat.

## Stage 4 — log in

Explain: "Now I'll log the tool into KSeF. It stores its own session locally in
`~/.ksef/` (permissions 600) and re-logins automatically after this."

```bash
ksef config set --nip <NIP>                              # remember the NIP; enables auto re-login
ksef auth login --token "$(cat ~/.ksef/token.txt)" --nip <NIP>
```

Environment is `prod` by default — do not pass `--env` (only `--env demo` in the
explicit sandbox case). After a successful login the CLI also stores the token in
`~/.ksef/credentials.json` (mode 600) for silent re-login.

If login fails: 400/403 usually means a mistyped token, missing permissions, or a token
from a different environment (a demo token won't work on prod) — walk the user back to
Stage 2 calmly.

## Stage 5 — verify, then tell the truth about the token

```bash
ksef auth whoami
```

Confirm to the user which NIP and environment they're on and that it works.

Then tell them plainly, **without alarm** (this is the tradeoff they chose for
simplicity):

1. **Where the token is saved:** `~/.ksef/token.txt` and `~/.ksef/credentials.json`
   (both readable only by their user account, permissions 600), under their home folder.
2. **It appeared in this chat's history:** they typed it into the conversation, so the
   value is stored in this session's transcript. Treat that transcript as sensitive.
3. **How to rotate it** if they want a clean token that never touched the chat:
   - In the portal (<https://ap.ksef.mf.gov.pl/web/> → Tokeny), revoke the current token
     and generate a new one, then re-run this setup — OR
   - revoke the current one from the CLI: `ksef auth revoke-self-token`, then generate a
     fresh token in the portal and log in again.

Finish by continuing with whatever the user originally wanted (send an invoice, query
invoices, download a UPO, etc.).
