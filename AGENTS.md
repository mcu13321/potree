# Potree

- Use `.agents/skills/potree-build-sync/SKILL.md` when changing, building or importing Potree distributions. Build/version behavior is documented in `docs/build-release.md` and enforced by the scripts.
- `package.json.version` is the version authority. Explicit versions win, pending uncommitted versions are reused, otherwise clean rebuilds retain the Git HEAD version, and only a dirty source worktree allocates HEAD + one patch. Generated records and build outputs do not count as source changes. Keep root package versions in package-lock.json aligned without regenerating dependency entries.
- Build through `npm run build`, `gulp build` or `gulp pack`. Do not patch generated bundles or invoke internal asset/Rollup tasks to publish incomplete distributions.
- Synchronize the entire distribution only to the target explicitly selected for the current task. Run release tests and relevant existing unit tests, then verify source and destination manifests.
- Preserve existing Chinese comments; write new or changed code comments in English. Commit/push only within the user's requested scope.
