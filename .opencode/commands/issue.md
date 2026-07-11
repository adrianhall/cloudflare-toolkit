# Issue Workflow

Use this workflow to implement a GitHub issue from `adrianhall/cloudflare-toolkit` with a single-responsibility pull request.

## Inputs

This command takes the GitHub issue number as its first argument:

```text
/issue 42
```

The issue number for this run is:

```text
$1
```

If that value is blank, stop and ask the user for an issue number before doing any other work. Every `$1` used later in this workflow refers to that same issue number.

## Workflow

1. Load project context.

   Read the specs in `docs`, `AGENTS.md` if present, and any files directly referenced by the issue. Load relevant skills before implementation. For Cloudflare, Workers, Wrangler, Hono, or auth work, retrieve current documentation before writing code.

2. Inspect the issue.

   Run:

   ```sh
   gh issue view $1 --comments --json number,title,body,comments,labels,state,url
   ```

   Summarize the requested outcome, acceptance criteria, files likely to change, and verification commands.

3. Ask clarifying questions.

   Ask concise questions only when implementation would otherwise require guessing. If the issue is clear, state the implementation assumption and continue.

4. Create a worktree.

   Because multiple issues are often worked on concurrently, do this work in a dedicated git worktree instead of switching branches in the current checkout. This keeps the primary checkout free for other in-progress work and avoids any risk of clobbering unrelated uncommitted changes there.

   Run this from the primary checkout (not from inside another issue's worktree) to compute the deterministic worktree path and check whether it already exists, following the `~/.worktrees/<repo-name>-<issue-number>` convention:

   ```sh
   REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
   WORKTREE_DIR="$HOME/.worktrees/${REPO_NAME}-$1"
   git worktree list
   ```

   If `$WORKTREE_DIR` already appears in that list, reuse it (resuming earlier work) and skip directly to step 5. Otherwise, create it, reusing the branch if it already exists locally (e.g. left over from a manually removed worktree) instead of failing on `-b`:

   ```sh
   if git show-ref --verify --quiet "refs/heads/issues/$1"; then
     git worktree add "$WORKTREE_DIR" issues/$1
   else
     git fetch origin main
     git worktree add "$WORKTREE_DIR" -b issues/$1 origin/main
   fi
   ```

   From this point forward, run every remaining command — build, test, `git status`/`diff`, commit, push — with `$WORKTREE_DIR` as the working directory, not the original checkout.

5. Plan the work.

   Create a short task list with implementation, tests, documentation, and verification. Keep the PR scope limited to the issue.

6. Implement.

   Make the smallest correct change that satisfies the issue and the relevant spec file, in the worktree. Keep all changes aligned with the spec. Use `apply_patch` for manual edits.

   For simple changes (less than 10 lines of fixed code), perform fixes on the main agent.

   For larger changes, use a coding sub-agent for implementation when the change touches multiple files or requires design choices. Sub-agents start with a fresh context and do not inherit the orchestrator's shell session — always include the absolute worktree path (the resolved value of `$WORKTREE_DIR`, not the variable name) explicitly in the sub-agent's prompt so it edits and runs commands in the right place. The coding sub-agent must return changed files, key decisions, and verification notes.

   Use a testing sub-agent after implementation, with the same absolute worktree path, to review tests and run or recommend targeted verification. The testing sub-agent must return gaps, failing cases, and commands run.

   Do not duplicate a sub-agent's work while it is running. Continue only with non-overlapping tasks or wait for results.

7. Test.

   Run targeted tests first, then full verification required by the issue, from within the worktree. At minimum, run:

   ```sh
   npm run check
   npm run build
   npm run test
   ```

   These checks must run with zero warnings or errors. Fix the warnings or errors before continuing. Only bypass these checks if the issue text explicitly tells you they are bypassable.

8. Determine whether a changeset is required.

   Per `CONTRIBUTING.md`'s "Adding a changeset" section, decide based on the actual diff produced in steps 6–7 — not just the issue title or description — whether this PR touches **published surface area**: the root export or any of the `guards`/`errors`/`problem-details`/`logging`/`hono`/`vite`/`testing` subpaths, or the `generate-wrangler-types` CLI. An issue that sounds docs- or test-only can still touch a public export's JSDoc or behavior and need one; an issue that edits `package.json` devDependencies, CI config, or internal tooling (no consumer-visible change) does not.

   If a changeset **is** required, add one before opening the PR:

   ```sh
   npx changeset
   ```

   This prompts interactively for the bump type (patch/minor/major) and a summary. If running non-interactively (e.g. from a sub-agent, or any context without a TTY), write the file directly under `.changeset/` instead, matching the format the CLI itself produces — YAML frontmatter naming the package and semver bump type, followed by a short, user-facing summary of the change:

   ```markdown
   ---
   "@adrianhall/cloudflare-toolkit": patch
   ---

   <one-line, user-facing summary of what changed and why it matters to consumers>
   ```

   Choose `patch`/`minor`/`major` per standard semver for the actual change being shipped, then verify it was picked up correctly:

   ```sh
   npx changeset status
   ```

   Commit the resulting `.changeset/*.md` file along with the rest of the change in step 10.

   If no changeset is required, do not create one — but state the reasoning in the completion response (step-by-step against the "published surface area" definition above) rather than silently skipping this step.

9. Review changes.

   Inspect, from within the worktree:

   ```sh
   git status --short
   git diff
   ```

   Confirm only intended files changed, including exactly one new `.changeset/*.md` file if step 8 determined one was needed (and none if it determined one wasn't). Check for secrets, generated files, account-specific IDs, and accidental edits to unrelated work.

10. Commit.

    Use a conventional commit message scoped to the issue from within the worktree, for example:

    ```sh
    git add INTENDED_FILES
    git commit -m "(#$1) feat: implement issue summary"
    ```

    Do not amend existing commits unless explicitly asked.

11. Push.

    Push the branch, from within the worktree:

    ```sh
    git push -u origin issues/$1
    ```

12. Open a PR.

    Create a pull request with `gh`, from within the worktree:

    ```sh
    gh pr create --repo adrianhall/cloudflare-toolkit --fill --base main --head issues/$1
    ```

    The PR body must include the issue link, summary, tests run, any known limitations, and whether a changeset was added (or, if not, the one-line reasoning from step 8 for why one wasn't needed).

## Worktree Cleanup

Do not remove the worktree as part of this workflow — the branch may still need follow-up commits during PR review.

## Completion Response

When done, report:

- Issue number, branch name, worktree path, and PR URL.
- Summary of implementation.
- Whether a changeset was added, and the reasoning either way.
- Tests and checks run, and their results.
- CI run URL and outcome.
- Any skipped verification with reasons.
- Any follow-up issues discovered.
