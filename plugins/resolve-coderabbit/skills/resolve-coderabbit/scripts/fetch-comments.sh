#!/usr/bin/env bash
#
# resolve-coderabbit — fetch unresolved CodeRabbit inline comments for a PR
# as a JSON array, ready to iterate over.
#
# Usage:
#   bash "${CLAUDE_SKILL_DIR}/scripts/fetch-comments.sh" [<pr_number>]
#
# Arguments:
#   pr_number  Optional. If omitted, the PR attached to the current
#              branch is used (via `gh pr view --json number`).
#
# Output (stdout):
#   A JSON array, one object per unresolved CodeRabbit thread, shaped:
#     [
#       {
#         "thread_id":  "PRRT_kwDO...",   # GraphQL node ID, for resolve
#         "comment_id": 1234567890,        # numeric, for REST /replies
#         "path":       "src/foo.ts",
#         "line":       42,
#         "body":       "**issue**\n\n..." # full comment body, raw markdown
#       },
#       ...
#     ]
#
#   An empty array means no unresolved CodeRabbit threads were found
#   (either everything is already resolved, or the bot never reviewed
#   this PR). Exit code is still 0 in that case.
#
# What it fetches:
#   A single GraphQL `reviewThreads` query, pulling the first comment of
#   each thread along with its databaseId, author, path, line, and body.
#   Filtered to threads where isResolved == false and author.login ==
#   "coderabbitai". No separate REST call is needed — GraphQL already
#   carries the body.

set -u

PR="${1:-}"
if [ -z "$PR" ]; then
  PR=$(gh pr view --json number --jq .number 2>/dev/null)
  if [ -z "$PR" ]; then
    echo "error: no PR number provided and cannot detect one from the current branch" >&2
    echo "usage: $0 [<pr_number>]" >&2
    exit 1
  fi
fi

REPO_NWO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)
if [ -z "$REPO_NWO" ]; then
  echo "error: cannot detect repo (run inside a git clone with a GitHub remote, authenticated via gh)" >&2
  exit 1
fi

OWNER="${REPO_NWO%%/*}"
REPO="${REPO_NWO##*/}"

gh api graphql \
  -f query='
    query($owner:String!,$repo:String!,$pr:Int!) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$pr) {
          reviewThreads(first:100) {
            nodes {
              id
              isResolved
              comments(first:1) {
                nodes {
                  databaseId
                  author { login }
                  path
                  line
                  body
                }
              }
            }
          }
        }
      }
    }' \
  -f owner="$OWNER" -f repo="$REPO" -F pr="$PR" \
  --jq '[
    .data.repository.pullRequest.reviewThreads.nodes[]
    | select(.isResolved == false)
    | select(.comments.nodes[0].author.login == "coderabbitai")
    | {
        thread_id:  .id,
        comment_id: .comments.nodes[0].databaseId,
        path:       .comments.nodes[0].path,
        line:       .comments.nodes[0].line,
        body:       .comments.nodes[0].body
      }
  ]'
