# Statusline

A custom statusline for Claude Code. A single bash script with no plugin dependencies.

## What it looks like

```
Opus 4.8 high  [█████▎  ] 67%  📁 flugins | 🌿 main | #42 ●
```

In the live terminal each segment is colored (effort by level, the context bar
by fill level, the PR/MR marker by review state). Left to right:

| Segment | What it shows |
|---------|---------------|
| `Opus 4.8` | Model (`display_name`) |
| `high` | Reasoning effort level — colored by level (`low`→green, `medium`→cyan, `high`→yellow, `xhigh`→magenta, `max`→bright red bold) |
| `[█████▎  ] 67%` | Context window usage. A bar of 1/8-blocks, color changes: green <30%, yellow 30–80%, red >80% |
| `📁 flugins` | Current working directory name |
| `🌿 main` | Current git branch |
| `#42 ●` | PR/MR number and status. `#` for GitHub, `!` for GitLab. Status: `●` open (yellow), `✓` approved (green), `✗` changes requested (red), `◌` draft (gray) |

The PR/MR status is resolved via `gh`/`glab`, cached, and refreshed in the
background (stale-while-revalidate, 90s TTL), so the statusline render **never
blocks** on network requests. A fork scenario is supported: the PR is also
looked up in the `upstream` repository by the fork's branch.

## Requirements

- `jq` — required (parses the JSON Claude Code feeds in)
- `gh` (GitHub) and/or `glab` (GitLab) — optional, only for the PR/MR segment

## Installation

### Option 1 — via `/statusline` (one step)

In Claude Code, run:

```
/statusline download https://raw.githubusercontent.com/Flopsstuff/flugins/main/statusline/statusline-command.sh to ~/.claude/statusline-command.sh, make it executable, and wire it up in settings.json
```

The statusline agent fetches the script, sets the executable bit, and writes the
`statusLine` entry into `~/.claude/settings.json` for you.

### Option 2 — manual

1. Copy the script statusline-command.sh
2. Add to `~/.claude/settings.json`:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "bash $HOME/.claude/statusline-command.sh"
     }
   }
   ```
3. Restart Claude Code.

## Customization

Colors (ANSI palette), the context-bar color thresholds (`30` / `80`), the bar
width (`width=8`), and the PR cache TTL (`90`) are all defined directly in
`statusline-command.sh` — tweak them to taste.
