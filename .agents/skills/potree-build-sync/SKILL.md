---
name: potree-build-sync
description: 在 Potree 源码中修改、打包或将完整产物同步到外层项目时使用，统一执行基于已提交版本的递增、手动版本覆盖、版本记录和文件哈希校验。
---

# Potree build and sync

Locate the Potree source repository from the current task or local project configuration. Read its AGENTS.md and docs/build-release.md. Run commands from that repository; target paths must be absolute dedicated directories named `potree`.

## Version contract

- `package.json.version` is the only editable version authority. The scripts also update the root package versions in `package-lock.json` and derive `Potree.version` from it.
- Choose the version in this order: explicit `--version`, a working package version differing from Git HEAD, otherwise retain HEAD's version when clean, or allocate HEAD's patch number + 1 when the source worktree has changes.
- Repeated builds before committing retain the pending version. After that version is committed, clean rebuilds keep it; another source edit is required to allocate the next patch. Staged, unstaged and untracked nonignored files count as changes; generated build outputs, version records and build locks do not. An explicit override such as `1.10.0` remains exact; `1.10.x` is not a concrete version.
- Do not increment again when committing or copying an existing artifact. A build's source commit means HEAD at build time; dirty builds must retain their provenance and artifact digest.

## Commands

```powershell
npm run build
npm run build -- --version 1.10.0 --target "D:/example/web/public/potree_libs/potree"
npm run verify:build
npm run sync:build -- --target "D:/example/web/public/potree_libs/potree"
```

Use `--target` only for the outer project explicitly selected by the user or the active task. Never broadcast to other consumers. Copy the complete distribution through the sync script, including JS, maps, CSS, HTML, workers, WASM, resources, lazy libraries, LICENSE and version.json.

Use the release entry points (`npm run build`, `gulp build`, `gulp pack`) rather than invoking internal assets/bundle tasks or Rollup directly. Fix Potree source and rebuild instead of patching deployed bundles or reconstructing only selected modules from source maps.

## Verification and completion

- Run the release tests and the existing unit tests for changed runtime modules. Verify the completed distribution and the synchronized target using `sync-potree.mjs --check --source <directory>`.
- Confirm package and runtime versions match; root/build/target version.json files must be byte-identical after a successful build and sync.
- On failure, use the reported error and preserved previous distribution. Remove a stale `.potree-build.lock` only after confirming its owning process has stopped.
- Report version, buildId, tests and exact target. Commit or push only when requested. When a commit is requested, build first and commit the prepared version; clean builds after committing must keep that version and leave the source worktree clean. Validate this with consecutive real rebuilds before reporting completion.
