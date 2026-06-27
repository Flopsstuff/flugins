#!/usr/bin/env bash
# Custom Claude Code statusline.
#   Layout:  <model> <effort>  [ctx-bar] NN%   📁 dir | 🌿 branch | <pr/mr>
#   - effort  (.effort.level)            colored by level
#   - context (.context_window.used_percentage) drawn as an eighth-block bar, colored by fill
#   - pr/mr   resolved via gh/glab, cached + refreshed in the background so the render NEVER blocks
input=$(cat)

# ---- palette ----
RESET=$'\033[0m'; BOLD=$'\033[1m'
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
MAGENTA=$'\033[35m'; CYAN=$'\033[36m'; GRAY=$'\033[90m'; BRED=$'\033[91m'

j() { printf '%s' "$input" | jq -r "$1" 2>/dev/null; }

# ---- model + effort ----
model=$(j '.model.display_name // .model.id // "?"')
effort=$(j '.effort.level // empty')
effort_seg=""
if [ -n "$effort" ]; then
  case "$effort" in
    low)    ec=$GREEN ;;
    medium) ec=$CYAN ;;
    high)   ec=$YELLOW ;;
    xhigh)  ec=$MAGENTA ;;
    max)    ec=$BRED$BOLD ;;
    *)      ec=$GRAY ;;
  esac
  effort_seg=" ${ec}${effort}${RESET}"
fi

# ---- context: eighth-block bar ----
used=$(j '.context_window.used_percentage // empty')
ctx_seg=""
if [ -n "$used" ]; then
  pct=$(printf '%.0f' "$used" 2>/dev/null || echo 0)
  [ "$pct" -lt 0 ] 2>/dev/null && pct=0
  [ "$pct" -gt 100 ] 2>/dev/null && pct=100
  width=8
  eighths=( "▏" "▎" "▍" "▌" "▋" "▊" "▉" )   # 1/8 .. 7/8 (full = █)
  total=$(( pct * width * 8 / 100 ))           # 0..64
  full=$(( total / 8 )); part=$(( total % 8 ))
  fill=""; empty=""; cells=0
  while [ $cells -lt $full ]; do fill+="█"; cells=$((cells+1)); done
  if [ $part -gt 0 ] && [ $cells -lt $width ]; then fill+="${eighths[$((part-1))]}"; cells=$((cells+1)); fi
  while [ $cells -lt $width ]; do empty+=" "; cells=$((cells+1)); done
  if   [ "$pct" -gt 80 ]; then cc=$RED
  elif [ "$pct" -ge 30 ]; then cc=$YELLOW
  else                         cc=$GREEN; fi
  ctx_seg="  [${cc}${fill}${RESET}${GRAY}${empty}${RESET}] ${cc}${pct}%${RESET}"
fi

# ---- working dir ----
dir=$(j '.workspace.current_dir // .cwd // empty')
dir_seg=""
[ -n "$dir" ] && dir_seg="  ${BOLD}📁 ${dir##*/}${RESET}"

# ---- branch + pr/mr (cached, non-blocking) ----
branch_seg=""; pr_seg=""
if [ -n "$dir" ] && git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$dir" branch --show-current 2>/dev/null)
  [ -n "$branch" ] && branch_seg=" | 🌿 ${branch}"

  top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)
  remote=$(git -C "$dir" remote get-url origin 2>/dev/null)
  if [ -n "$branch" ] && [ -n "$top" ] && [ -n "$remote" ]; then
    plat=""
    case "$remote" in
      *gitlab*) command -v glab >/dev/null 2>&1 && plat=gl ;;
      *github*) command -v gh   >/dev/null 2>&1 && plat=gh ;;
      *)        command -v gh   >/dev/null 2>&1 && plat=gh ;;
    esac
    if [ -n "$plat" ]; then
      cdir="${TMPDIR:-/tmp}/claude-statusline"; mkdir -p "$cdir" 2>/dev/null
      key=$(printf 'v2|%s|%s' "$top" "$branch" | cksum | tr -d ' ')
      cf="$cdir/pr-$key"
      now=$(date +%s)
      mtime=$(stat -f %m "$cf" 2>/dev/null || stat -c %m "$cf" 2>/dev/null || echo 0)
      age=$(( now - mtime ))
      # refresh in background when stale (>90s), missing, or empty; lock prevents stampede
      if [ ! -f "$cf" ] || [ ! -s "$cf" ] || [ "$age" -ge 90 ]; then
        if mkdir "$cf.lock" 2>/dev/null; then
          nohup bash -c '
            plat="$1"; top="$2"; branch="$3"; cf="$4"; out=""
            if [ "$plat" = gh ]; then
              d=""; n=""
              # Try gh pr view first (works when PR is in origin repo)
              d=$(cd "$top" && gh pr view --json number,isDraft,reviewDecision 2>/dev/null)
              n=$(printf "%s" "$d" | jq -r ".number // empty" 2>/dev/null)
              # Fork fallback: PR may be in upstream repo, branch pushed to fork
              if [ -z "$n" ] || [ "$n" = "null" ]; then
                upstream_url=$(git -C "$top" remote get-url upstream 2>/dev/null)
                origin_url=$(git -C "$top" remote get-url origin 2>/dev/null)
                if [ -n "$upstream_url" ] && [ -n "$origin_url" ]; then
                  upstream_repo=$(printf "%s" "$upstream_url" | sed -E "s|.*github\\.com[:/]([^/]+/[^/.]+)(\\.git)?.*|\\1|")
                  fork_owner=$(printf "%s" "$origin_url" | sed -E "s|.*github\\.com[:/]([^/]+)/.*|\\1|")
                  if [ -n "$upstream_repo" ] && [ -n "$fork_owner" ]; then
                    arr=$(gh pr list --repo "$upstream_repo" --head "$branch" --state all --json number,isDraft,reviewDecision,headRepositoryOwner --limit 10 2>/dev/null)
                    d=$(printf "%s" "$arr" | jq -c --arg owner "$fork_owner" "[.[] | select(.headRepositoryOwner.login==\$owner)][0] // empty" 2>/dev/null)
                    n=$(printf "%s" "$d" | jq -r ".number // empty" 2>/dev/null)
                  fi
                fi
              fi
              if [ -n "$n" ] && [ "$n" != "null" ]; then
                st=$(printf "%s" "$d" | jq -r "if .isDraft then \"draft\" elif .reviewDecision==\"APPROVED\" then \"approved\" elif .reviewDecision==\"CHANGES_REQUESTED\" then \"changes\" else \"open\" end" 2>/dev/null)
                out=$(printf "gh\t%s\t%s" "$n" "$st")
              fi
            else
              d=$(cd "$top" && glab mr list --source-branch "$branch" -P 1 -F json 2>/dev/null)
              n=$(printf "%s" "$d" | jq -r ".[0].iid // empty" 2>/dev/null)
              if [ -n "$n" ]; then
                st=$(printf "%s" "$d" | jq -r ".[0] | if (.draft // .work_in_progress) then \"draft\" else \"open\" end" 2>/dev/null)
                out=$(printf "gl\t%s\t%s" "$n" "$st")
              fi
            fi
            printf "%s" "$out" > "$cf"
            rmdir "$cf.lock" 2>/dev/null
          ' _ "$plat" "$top" "$branch" "$cf" >/dev/null 2>&1 &
          disown 2>/dev/null
        fi
      fi
      # render from cache (stale-while-revalidate)
      if [ -s "$cf" ]; then
        IFS=$'\t' read -r cp num st < "$cf"
        if [ -n "$num" ]; then
          case "$cp" in gl) sym="!" ;; *) sym="#" ;; esac
          case "$st" in
            approved) pc=$GREEN;  g="✓" ;;
            changes)  pc=$RED;    g="✗" ;;
            draft)    pc=$GRAY;   g="◌" ;;
            *)        pc=$YELLOW; g="●" ;;
          esac
          pr_seg=" | ${pc}${sym}${num} ${g}${RESET}"
        fi
      fi
    fi
  fi
fi

printf '%s%s%s%s%s%s\n' "${BOLD}${model}${RESET}" "$effort_seg" "$ctx_seg" "$dir_seg" "$branch_seg" "$pr_seg"
