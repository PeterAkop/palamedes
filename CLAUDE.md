# Project rules for Claude

Claude Code reads this file automatically and follows the rules here on this project.
Add new rules as we agree on them.

## Git / remote operations

- **Do not `git push` (or otherwise publish to a remote) without explicit
  per-action approval from the user.** Ask first, every time.
- Local commits are fine. After committing, summarise what was committed and
  **ask before pushing.**
- The same rule applies to any other remote-publishing action — e.g.
  `gh repo create`, `gh pr create`, deploys triggered from here.
