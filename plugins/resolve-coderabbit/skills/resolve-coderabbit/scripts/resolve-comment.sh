#!/usr/bin/env bash
#
# resolve-coderabbit — post a reply to a CodeRabbit inline PR comment
# and mark its review thread resolved, in one call.
#
# Usage:
#   bash "${CLAUDE_SKILL_DIR}/scripts/resolve-comment.sh" \
#     <comment_id> <thread_id> <reply_body>
#
# Arguments:
#   comment_id  Numeric ID of the inline comment being replied to. The
#               reply is posted as a child in the same review thread.
#   thread_id   GraphQL node ID of the review thread (starts with
#               PRRT_...), used by the resolveReviewThread mutation.
#               REST alone cannot resolve threads.
#   reply_body  Full body text of the reply. Quote it so the whole
#               string is a single shell argument; apostrophes inside
#               are fine.
#
# Behaviour:
#   1. Detects OWNER/REPO via `gh repo view --json nameWithOwner` and
#      the PR number via `gh pr view --json number`.
#   2. Posts the reply (REST: POST /pulls/<pr>/comments/<id>/replies).
#   3. Marks the thread resolved (GraphQL: resolveReviewThread).
#   4. Prints a one-line summary. Exits 0 on success.
#
# Failure handling:
#   - If the reply fails, the thread is NOT resolved. We refuse to
#     resolve a thread without a posted explanation.
#   - If the reply succeeded but the resolve failed, the script exits
#     non-zero so the caller knows the thread still needs resolving.
#     The reply itself stays on the PR.

set -u

if [ "$#" -lt 3 ]; then
  cat >&2 <<EOF
Usage: $0 <comment_id> <thread_id> <reply_body>
Missing required argument.
EOF
  exit 2
fi

COMMENT_ID="$1"
THREAD_ID="$2"
REPLY_BODY="$3"

if [ -z "$COMMENT_ID" ] || [ -z "$THREAD_ID" ] || [ -z "$REPLY_BODY" ]; then
  echo "error: empty argument (comment_id, thread_id, reply_body all required)" >&2
  exit 2
fi

REPO_NWO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)
if [ -z "$REPO_NWO" ]; then
  echo "error: cannot detect repo (run inside a git clone with a GitHub remote, authenticated via gh)" >&2
  exit 1
fi

PR=$(gh pr view --json number --jq .number 2>/dev/null)
if [ -z "$PR" ]; then
  echo "error: cannot detect PR number for the current branch (open a PR first, or check out the PR branch)" >&2
  exit 1
fi

echo "Posting reply to comment $COMMENT_ID on $REPO_NWO #$PR..."
REPLY_ID=$(gh api "repos/$REPO_NWO/pulls/$PR/comments/$COMMENT_ID/replies" \
  -f body="$REPLY_BODY" \
  --jq '.id' 2>&1)
REPLY_RC=$?

if [ "$REPLY_RC" -ne 0 ] || [ -z "$REPLY_ID" ]; then
  echo "error: reply failed (rc=$REPLY_RC): $REPLY_ID" >&2
  echo "  thread $THREAD_ID was NOT resolved — fix the reply and retry" >&2
  exit 1
fi
echo "  reply posted: id=$REPLY_ID"

echo "Resolving thread $THREAD_ID..."
RESOLVE_OUT=$(gh api graphql \
  -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' \
  -f t="$THREAD_ID" \
  --jq '.data.resolveReviewThread.thread.isResolved' 2>&1)
RESOLVE_RC=$?

if [ "$RESOLVE_RC" -ne 0 ] || [ "$RESOLVE_OUT" != "true" ]; then
  echo "error: resolve failed (rc=$RESOLVE_RC): $RESOLVE_OUT" >&2
  echo "  reply $REPLY_ID WAS posted, but thread $THREAD_ID still needs resolving" >&2
  exit 1
fi
echo "  thread resolved"

echo "OK: comment $COMMENT_ID → reply $REPLY_ID, thread $THREAD_ID resolved."
