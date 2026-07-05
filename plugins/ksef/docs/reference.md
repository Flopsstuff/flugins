# ksef CLI — full reference (v0.10.0)

Source of truth: `packages/ksef-client-ts/src/cli/` in the `ksef-client-ts` repo.
Where this file and the repo's `docs/cli.md` disagree, this file follows the code
(see [Known discrepancies](#known-discrepancies-vs-the-repos-docsclimd)).

## Official documentation — read these when this file is not enough

**The `ksef` CLI / client library (ksef-client-ts):**

- Docs site (guides, CLI page, API reference): <https://flopsstuff.github.io/ksef-client-ts/>
- Source & issues (GitHub): <https://github.com/Flopsstuff/ksef-client-ts>
- npm package: <https://www.npmjs.com/package/ksef-client-ts>

**Official KSeF (Polish Ministry of Finance) — the system this CLI talks to:**

- KSeF information portal (Ministry of Finance): <https://www.podatki.gov.pl/ksef/>
- Official KSeF technical docs — API guides, invoice XSD schemas, changelog
  (CIRFMF/ksef-docs): <https://github.com/CIRFMF/ksef-docs>
- Live API OpenAPI spec (authoritative for endpoints/fields): TEST
  <https://api-test.ksef.mf.gov.pl/docs/v2/openapi.json> — content matches PROD
  <https://api.ksef.mf.gov.pl/docs/v2/openapi.json>
- Web portals (browser login, token generation, permission management): see the
  [Environments](#environments) table below.

When a KSeF error, field, or behavior is not explained here, fetch the OpenAPI spec or
the CIRFMF/ksef-docs page before guessing; for CLI-specific behavior use the docs site
or the source repo above.

## Installation & invocation

- Install from npm: `npm install -g ksef-client-ts` (Node 18+; `pnpm add -g` /
  `bun add -g` / `yarn global add` also work). This provides the `ksef` command.
- Update: `npm update -g ksef-client-ts`. Version check: `ksef --help | head -1`.
- `--help` works at root and group level only; `ksef <group> <sub> --help` prints the
  root help (citty quirk). Subcommand flags are documented here instead.

## Environments

| Env | API | Web portal |
|---|---|---|
| `prod` (default!) | `https://api.ksef.mf.gov.pl` | `https://ap.ksef.mf.gov.pl/web/` |
| `test` | `https://api-test.ksef.mf.gov.pl` | `https://ap-test.ksef.mf.gov.pl/web/` |
| `demo` | `https://api-demo.ksef.mf.gov.pl` | `https://ap-demo.ksef.mf.gov.pl/web/` |

Fully isolated from each other. TEST accepts self-signed certificates for auth and
auto-creates contexts for any checksum-valid NIP; DEMO/PROD require real auth means.
The `lighthouse` group supports only `test`/`prod` (no DEMO lighthouse).

## State on disk (`~/.ksef/`)

| File | Contents | Mode |
|---|---|---|
| `config.json` | `environment` (default `prod`), `nip?`, `output` (`pretty`/`json`), `timeout` (30000) | default |
| `session.json` | access/refresh tokens, `sessionRef`, `onlineSessionRef`, `expiresAt`, environment, cipher key/IV | `0600` |
| `credentials.json` | long-lived KSeF token + its reference number (enables silent re-login) | `0600` |
| `pending-challenge.json` | pending external-signing challenge (`auth login-external --generate`) | `0600` |
| `auth.xml` | unsigned auth XML written by `setup` | default |
| `offline/` | offline invoice store (override per command with `--store-dir`) | — |

## Flags and precedence

- The CLI reads **no environment variables**. Precedence: command flag →
  `config.json` → hardcoded default (`env=prod`, `timeout=30000`).
- The "common" flags `--env --json --verbose --timeout --nip` are re-declared per
  command. Commands **without** the full set: `config set/show/reset`,
  `invoice build` (own arg set), `invoice validate` (only `--schema --json`),
  `completion *`, `setup` (only `--env`). `--no-color` exists in types but is not wired.
- `--verbose` enables HTTP request/response logging; `--json` switches all output to JSON
  (errors become `{ "error": ... }` on stdout).

## Session recovery (what "requires session" means)

Commands marked *(session)* call `requireSession()`:

1. Stored session valid → use it.
2. Expired + refresh token → refresh, persist, continue.
3. Else `credentials.json` token + config `nip` → full re-login, persist, continue.
4. Else error: no token → ``Run `ksef setup` ``; token but no NIP → ``Run `ksef config set nip ...` ``.

Env resolution during recovery: `--env` flag → session's env → config env.
`requireOnlineSession()` additionally needs `onlineSessionRef` from `ksef session open`,
else: ``Run `ksef session open` first``.

## Command groups

### `setup`

Interactive wizard (config → auth → optional token generation). Flags: `--env`.
**Requires a TTY** — cannot be run through non-interactive shells. On TEST offers
self-signed-cert quick auth (company seal, `VATPL-<nip>`); otherwise external
XAdES signing flow; writes `config/session/credentials/auth.xml`.

### `config`

| Sub | Purpose | Flags |
|---|---|---|
| `set` | Update config | `--env`, `--nip`, `--output pretty\|json`, `--timeout <ms>`. Changing `--env` **clears the session**. |
| `show` | Show config | `--json` |
| `reset` | Defaults + **clears session** | — |

### `auth`

| Sub | Purpose | Key flags |
|---|---|---|
| `challenge` | Request authorization challenge | — |
| `login` | Authenticate | `--token` (or stored credential), or `--p12 --p12-password`, or `--cert --key [--key-password]`; `--nip`. Token login persists credentials for silent re-login. |
| `login-external` | Externally-signed XAdES auth | `--generate` or `--submit` (one required), `--nip`, `--context-type Nip\|InternalId\|NipVatUe\|PeppolId`, `--output <file>` (unsigned XML), `--input <signed xml>` (else stdin) |
| `status` | Auth status by reference | `ref` (pos, req) *(session)* |
| `logout` | Clear local session | — |
| `revoke-self-token` | Revoke the token used for current login (discovery-first, idempotent) | `--keep-local`, `--dry-run` *(session)* |
| `refresh` | Refresh access token | needs stored refresh token |
| `whoami` | Show session context (decoded JWT) | `--json`; **exit 1** if no recoverable session |

### `session` *(all session)*

| Sub | Purpose | Key flags |
|---|---|---|
| `open` | Open online session | `--formCode FA2\|FA3\|PEF3\|PEFKOR3\|FARR1` (default FA3), `--nip`. Saves `onlineSessionRef` + cipher keys. `--batch` throws (batch is internal to `invoice send <dir>`). |
| `close` | Close session | `ref` (pos; falls back to stored `onlineSessionRef`) |
| `status` | Session status | `ref` (pos) |
| `list` | List sessions | `--type online\|batch` (default online), `--pageSize` |
| `invoices` | Invoices in a session | `ref` (pos), `--pageSize` |
| `failed` | Failed invoices in a session | `ref` (pos), `--pageSize` |
| `upo` | Download UPO receipt | `sessionRef` (pos, req) + one of `--upoRef` / `--ksefNumber` / `--invoiceRef`; `--parsed`, `-o <file>` |
| `active` | Active auth sessions | `--pageSize` |
| `revoke` | Revoke an auth session | `ref` (pos) OR `--current` |
| `invoice` | Single invoice status in session | `invoiceRef` (pos, req), `--ref <sessionRef>` |

### `invoice`

| Sub | Purpose | Key flags |
|---|---|---|
| `send` | Send XML file / directory (batch) / ZIP | `path` (pos, req), `--sessionRef`, `--stream` (ZIP streaming), `--formCode` (default FA3), `--validate`, `--parallelism <n>`, `--nip`. Single file → needs open online session; directory → auto batch open/send/close. *(session)* |
| `build` | JSON/YAML → invoice XML | `input` (pos, or `-` stdin), `--schema FA2\|FA3\|PEF\|PEF_KOR`, `-o/--output`, `--pretty`, `--validate`, `--validate-xsd` (needs libxmljs2), `--dry-run`, `--format json\|yaml\|auto`, `--template <schema>` (print skeleton), `--json`. Exit codes 0/2/3/4/5. No session. |
| `get` | Download invoice XML | `ksefNumber` (pos, req), `-o <file>` *(session)* |
| `query` | Query invoice metadata | `--from` (req), `--to`, `--subjectType`, `--dateType`, `--sellerNip`, `--buyerNip`, `--amountFrom`, `--amountTo`, `--amountType`, `--currency`, `--page`, `--size` *(session)* |
| `validate` | Validate XML against schema | `files...` (pos, req; file/dir), `--schema`, `--json`. Exit 1 if any invalid. No session. |
| `export` | Start async export | query filters + `--onlyMetadata` *(session)* |
| `export-status` | Export status | `ref` (pos, req) *(session)* |
| `export-incremental` | Incremental export with HWM state | `--from` (req), `--to`, `--subjectType`, `--stateFile` (default `./ksef-hwm-state.json`), `--outputDir` (default `./ksef-exports`), `--maxIterations` (default 20), `--onlyMetadata` *(session)* |

**Date-range cap:** KSeF limits the `--from`/`--to` window to **3 months** (measured in
UTC or Europe/Warsaw) for `query`, `export`, and `export-incremental`. A wider span is
rejected — split into consecutive ≤3-month windows. Omitting `--to` defaults it to the
current time.

### `permission` *(all session)*

| Sub | Purpose | Key flags |
|---|---|---|
| `grant` | Grant permissions | `--type person\|entity\|authorization\|indirect\|subunit\|eu-entity-admin\|eu-entity-representative` (req), `--description` (req); per-type: `--identifier`, `--identifierType`, `--targetNip`, `--permissions`, `--firstName`, `--lastName`, `--fullName`, `--contextNip`, `--subunitName`, `--contextNipVatUe`, `--euEntityName`, `--address`, `--canDelegate` |
| `revoke` | Revoke a grant | `grantId` (pos, req), `--authorization` |
| `search` | Search permissions | `--type personal\|persons\|subunits\|entities\|entities-grants\|subordinate-entities\|authorizations\|eu-entities` (req), `--identifier`, `--identifierType`, `--queryType`, `--contextType Nip\|InternalId`, `--contextValue`, `--page`, `--pageSize` |
| `status` | Operation status | `ref` (pos, req) |
| `attachment-status` | Attachment permission allowed? | — |

### `token` *(all session)*

| Sub | Purpose | Key flags |
|---|---|---|
| `generate` | New KSeF token | `--permissions` (CSV, req), `--description` (req). **No `--validTo`** (docs are wrong). |
| `list` | List tokens | `--status` (CSV), `--description`, `--author`, `--authorType`, `--continue`, `--pageSize` |
| `get` | Token details | `ref` (pos, req) |
| `revoke` | Revoke token | `ref` (pos, req) |

### `cert`

| Sub | Purpose | Key flags |
|---|---|---|
| `generate` | Self-signed cert → `cert.pem` + `key.pem` | `--type personal\|company-seal` (req), `--cn` (req), `--country` (PL), company: `--org` + `--org-identifier` (e.g. `VATPL-<nip>`); personal: `--given-name` + `--surname` + `--serial-number`; `--method RSA\|ECDSA`, `--out <dir>` (default `.`), `--force`. No session. |
| `enroll` | Submit enrollment | `--cert` (req), `--name` (req), `--type Authentication\|Offline` (req), `--valid-from` *(session)* |
| `status` | Enrollment status | `ref` (pos, req) |
| `list` | Query certificates | `--serial`, `--name`, `--type`, `--status`, `--expires-after`, `--page`, `--page-size` |
| `revoke` | Revoke certificate | `serial` (pos, req), `--revocationReason` (NOT `--reason`) |
| `limits` | Certificate limits | — |
| `enrollment-data` | Enrollment data template | — |
| `retrieve` | Certs by serials | `--serial` (CSV, req) |

### `qr` (no session)

| Sub | Purpose | Key flags |
|---|---|---|
| `invoice` | Invoice QR code | `--nip --date --hash` (req), `--format png\|svg`, `--size` (300), `--label` (svg), `--offline`, `-o <file>` |
| `certificate` | Certificate QR code | `--context-type --context-id --seller-nip --cert-serial --hash --key` (req), `--key-password`, `--format`, `--size`, `--label`, `-o` |
| `url` | Verification URL only | `--nip --date --hash` (req) |

### `lighthouse` (no session; only test/prod)

`status`, `messages` — system status/messages; `--env`.

### `limits` *(session)*

`context` (session size/count limits), `subject` (enrollment/cert limits), `rate` (API rate limits).

### `peppol` *(session)*

`providers` — `--page`, `--pageSize`.

### `test-data` (refuses `prod`)

`create-subject`, `remove-subject`, `create-person`, `remove-person`,
`grant-permissions`, `revoke-permissions`, `enable-attachment`, `disable-attachment`,
`change-session-limits`, `restore-session-limits`, `change-cert-limits`,
`restore-cert-limits`, `set-rate-limits` (`--limits <json>`), `restore-rate-limits`,
`set-production-rate-limits`, `block-context`, `unblock-context`.
Most take `--nip` / `--context-nip` / `--identifier`; limit-changing ones require a session.

### `offline` (shared `--store-dir` on all subs)

| Sub | Purpose | Key flags |
|---|---|---|
| `generate` | Offline invoice metadata + QR | `xml` (pos, req), `--mode offline24\|offline\|awaryjny\|awaria_calkowita` (default offline24), `--key` + `--cert-serial`, `--context-type`, `--context-id`, `--qr-format png\|svg`, `--qr-out`, `--no-store` |
| `list` | List stored (local) | `--status`, `--mode`, `--expiring` |
| `status` | Details (local) | `id` (pos, req) |
| `submit` | Submit to KSeF *(session)* | `ids` (pos, CSV) or `--all`, `--no-check-expiry` |
| `correct` | Technical correction *(session)* | `id` (pos, req), `xml` (pos, req) |
| `delete` | Delete from local store | `id` (pos) or `--expired`, `--force` |

### `doctor`

Three checks: config validity, connectivity (lighthouse, 5s timeout), session presence/expiry.
Flags: `--env --json --timeout --nip --verbose`.

### `completion`

`bash` / `zsh` / `fish`. **The completion tree is hardcoded and stale** — it omits
`limits`, `peppol`, `offline`, `setup` and many newer subcommands. Do not treat
completion output as the command inventory.

## Output, errors, exit codes

- Errors render as RFC 7807 Problem Details with status-specific hints (400/401/403/404/410/429);
  with `--json` they are emitted as `{ "error": { ... } }` on stdout.
- Default exit code on error: **1**.
- `invoice build`: 0 ok, 2 parse error, 3 shape error, 4 XSD error, 5 I/O error.
- `invoice validate`: exit 1 when any file is invalid.
- `auth whoami`: exit 1 when no session is recoverable.
- KSeF business error **440** = duplicate invoice (`P_2` number already used).

## Known discrepancies vs the repo's `docs/cli.md`

| # | docs/cli.md says | Code reality |
|---|---|---|
| 1 | — (absent) | `auth login-external` exists (generate/submit XAdES flow) |
| 2 | `token generate --validTo` | flag does not exist |
| 3 | `cert revoke --reason` | flag is `--revocationReason` |
| 4 | — (absent) | `invoice export-incremental` exists |
| 5 | storage table: 3 files | also `pending-challenge.json`, `auth.xml`, `offline/` |
| 6 | "global options on most subcommands" | per-command flags; several commands lack them |
| 7 | — | shell completion tree is stale (see above) |
| 8 | `offline generate --mode` 3 values | 4th value `awaria_calkowita` exists |
