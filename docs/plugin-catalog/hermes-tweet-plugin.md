# Hermes Tweet Plugin

**Name:** `hermes-tweet`

**Description:** Guide Hermes Agent X/Twitter workflows with Hermes Tweet, the native Xquik plugin for social listening, research, audits, and controlled publishing.

**Author:** Xquik

**Version:** 0.1.6

**Keywords:** hermes-agent, xquik, twitter, x, social-media, automation

The Hermes Tweet plugin helps Claude Code users install and operate Hermes Tweet,
the native Hermes Agent X/Twitter plugin for Xquik workflows.

Use it for social listening, launch monitoring, support triage, creator
research, brand research, giveaway audits, community audits, and controlled
publishing.

## Installation

```bash
claude plugin install hermes-tweet@flugins
```

After installing this Claude Code plugin, install the Hermes Agent plugin:

```bash
hermes plugins install Xquik-dev/hermes-tweet --enable
```

Hermes prompts for `XQUIK_API_KEY` during interactive install. For
non-interactive installs, set the key in the Hermes runtime environment or
`~/.hermes/.env` before calling `tweet_read`.

## Usage

Mention Hermes Tweet, X/Twitter research, Xquik workflows, social listening,
launch monitoring, support triage, creator research, brand research, giveaway
audits, community audits, or controlled publishing. Claude Code will load the
skill guidance and keep X/Twitter operations on the Hermes Tweet route.

## Safety

- Use `tweet_explore` before any endpoint call.
- Use `tweet_read` for read-only X/Twitter endpoints.
- Use `tweet_action` only after explicit approval.
- Keep `HERMES_TWEET_ENABLE_ACTIONS=false` unless actions are required.
- Never paste credentials or secrets into chat.

Repository: <https://github.com/Xquik-dev/hermes-tweet>
