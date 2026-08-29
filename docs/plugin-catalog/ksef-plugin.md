# KSeF Plugin

**Name:** `ksef`

**Description:** Send and receive KSeF (Polish National e-Invoice System) invoices via the ksef CLI, with guided onboarding: install from npm, token setup, login

**Author:** Flop (flopspm@gmail.com)

**Version:** 0.1.1

**Keywords:** ksef, e-invoice, faktura, poland, invoice, cli, fa3, upo

The KSeF plugin teaches Claude Code to operate the `ksef` command-line tool (npm package [ksef-client-ts](https://www.npmjs.com/package/ksef-client-ts)) — a client for the Polish National e-Invoice System (KSeF). It is aimed at **regular users, not developers**: the skill focuses on the two everyday jobs — sending invoices and finding/downloading them — and includes a guided, conversational onboarding that installs the tool from npm, explains what a KSeF token is and how to generate it in the government portal, asks for the NIP and token, saves them locally, and logs in. Production environment by default.

## Installation

```bash
claude plugin install ksef@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate skills.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Requirements

- Node.js 18+ (the onboarding installs the CLI itself via `npm install -g ksef-client-ts`)
- Your company's NIP and a KSeF token (generated once in the [KSeF web portal](https://ap.ksef.mf.gov.pl/web/) — the onboarding explains where and how)

## Features

### Skill

- **ksef** — activates automatically when you ask to send, find, or download KSeF invoices, download UPO receipts, set up KSeF, or debug KSeF errors. You can also invoke it manually by typing **`/ksef`** (with no task, it checks setup and asks what you want to do).

### Onboarding

On first use (no CLI installed or not logged in) the skill switches to a guided onboarding: install → what a token is and how to generate it in the portal → enter NIP + token → login → verification. Every step is explained in plain language, and Claude performs the technical actions (installing, saving the token, logging in) itself. The token is entered in the chat once for simplicity; the final step tells the user exactly where it was saved, that it appeared in the chat history, and how to rotate it if they want a clean one.

### Usage

Type **`/ksef`** for an explicit start, or just ask in natural language, e.g.:

- *"Wyślij tę fakturę do KSeF"* / *"Send this invoice to KSeF"*
- *"Find my KSeF invoices since June and download the latest one"*
- *"Why am I getting error 440 from KSeF?"*

The skill checks auth state (`auth whoami`), runs onboarding if needed, and then performs the send/receive flow on the production environment (sandbox only on explicit request).

### What the skill knows that `--help` won't tell you

- The CLI reads **no environment variables** — everything goes through flags or `~/.ksef/config.json`, and the default environment is `prod`
- Nested `--help` (e.g. `ksef invoice send --help`) is broken and prints the root help — the skill ships a full flag-level reference for all 16 command groups (`docs/reference.md`)
- Session auto-recovery cascade, invoice-number uniqueness (error 440), batch vs online sessions, and known discrepancies between the CLI and the project's own docs

### Configuration

No install-time configuration. On first use the skill asks for your NIP and KSeF token in the chat, saves the token to `~/.ksef/token.txt` and logs in (the CLI then keeps its own session and credentials in `~/.ksef/`, permissions 600). This favors simplicity over secrecy: the token is typed into the conversation, so it lands in the chat history — the onboarding tells you this and how to rotate the token if you'd rather not keep one that touched the chat.
