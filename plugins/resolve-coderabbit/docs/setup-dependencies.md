# Setup Dependencies

The `resolve-coderabbit` skill depends on a few CLI tools and a valid GitHub login. When `scripts/self-check.sh` exits non-zero, use this guide to fix each failing check, then re-run the script until it exits 0.

Each section starts with the tag the self-check prints (e.g. `gh`, `gh-auth`) so you can map failures to fixes directly.

---

## `git`

Git is preinstalled on most developer machines, but if the self-check flagged it:

- **macOS** — `xcode-select --install` (Xcode Command Line Tools) or `brew install git`
- **Debian/Ubuntu** — `sudo apt update && sudo apt install -y git`
- **Fedora/RHEL** — `sudo dnf install -y git`
- **Arch** — `sudo pacman -S git`
- **Windows** — `winget install --id Git.Git -e` or download from <https://git-scm.com/download/win>

Verify: `git --version` should print a version and `git rev-parse --is-inside-work-tree` should succeed from the project directory.

---

## `gh` (GitHub CLI)

The skill uses `gh` for every GitHub API call (both REST and GraphQL). A web browser or `curl` is not a substitute.

- **macOS** — `brew install gh`
- **Debian/Ubuntu** — follow <https://github.com/cli/cli/blob/trunk/docs/install_linux.md> (official apt repo) or `sudo apt install gh` on recent distros
- **Fedora/RHEL** — `sudo dnf install gh`
- **Arch** — `sudo pacman -S github-cli`
- **Windows** — `winget install --id GitHub.cli` or `choco install gh`

Verify: `gh --version` should print a version. If the path resolves but the version is very old (< 2.30), upgrade — recent features (`gh api graphql`, `--jq`) matter.

---

## `gh-auth` (GitHub CLI authentication)

`gh` is installed but not logged in. Run:

```bash
gh auth login
```

Answer the prompts:

- **What account?** → GitHub.com (or your enterprise host)
- **Preferred protocol?** → HTTPS (simpler for most setups) or SSH
- **Authenticate Git with GitHub credentials?** → Yes (recommended)
- **How to authenticate?** → Login with a web browser (opens a one-time code flow) or paste a PAT

The account must have at least **write access** to the repo whose PR you want to resolve — CodeRabbit comments can only be replied to and threads resolved with write permissions.

For an **enterprise host**: `gh auth login --hostname github.mycorp.com`.

Verify: `gh auth status` should print `✓ Logged in to github.com as <you>`.

---

## `jq`

The self-check and many of the skill's `gh api ... --jq '...'` calls pipe JSON through `jq`.

- **macOS** — `brew install jq`
- **Debian/Ubuntu** — `sudo apt install -y jq`
- **Fedora/RHEL** — `sudo dnf install -y jq`
- **Arch** — `sudo pacman -S jq`
- **Windows** — `winget install --id jqlang.jq` or `choco install jq`

Verify: `echo '{"x":1}' | jq .x` prints `1`.

---

## `git-repo`

The self-check was run from a directory that is not inside a git working tree. `cd` into the local checkout of the repo whose PR you want to resolve, then re-run:

```bash
cd /path/to/your/repo
bash "${CLAUDE_PLUGIN_ROOT}/scripts/self-check.sh"
```

If the directory *should* be a repo but isn't, you probably need `git clone <url>` (for a fresh checkout) or `git init` (for a new project you intend to push to GitHub later — note the skill still needs an **already-opened PR**, so a brand-new repo won't do until you push and open one).

---

## After fixing

Re-run the self-check:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/self-check.sh"
```

When it exits 0 with all ✅ marks, the skill can continue with step 1 (resolving the PR number and pulling the comment set).
