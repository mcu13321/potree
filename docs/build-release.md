# Potree 构建与版本记录

`package.json.version` 是唯一可编辑版本来源。本次启用版本为 `1.9.0`。

## 版本选择

优先采用 `--version` 指定的完整数字版本；其次采用与当前 Git HEAD 不同的手动或待提交版本；若版本相同，工作区有未提交改动才将 HEAD 的最后一位加一，工作区干净则保持 HEAD 版本。检测包括已暂存、未暂存及未忽略的新文件，忽略构建产物、生成记录和构建锁。

例如 HEAD 为 `1.9.0`，干净工作区连续构建仍为 `1.9.0`；修改源码后构建为 `1.9.1`，未提交时重复构建仍为 `1.9.1`；提交该版本后，干净重建仍为 `1.9.1`，再修改源码才进入 `1.9.2`。`1.9.9` 有修改后的候选版本为 `1.9.10`，手动跳转可指定 `1.10.0`。版本未变化时保留 package/lock 原始字节和格式，确保构建本身不会弄脏源码工作区。

构建同时更新 package.json 和 package-lock.json 的根包版本。运行时 `Potree.version` 保持原有 major/minor/suffix 结构，从 package.json 派生。点云数据格式和项目文件格式版本不随产品版本更改。

## 使用方式

在 Potree 仓库执行：

```powershell
npm run build
npm run build -- --target "D:/example/web/public/potree_libs/potree"
npm run build -- --version 1.10.0 --target "D:/example/web/public/potree_libs/potree"
npm run verify:build
npm run sync:build -- --target "D:/example/web/public/potree_libs/potree"
node scripts/sync-potree.mjs --check --source "D:/example/web/public/potree_libs/potree"
npm test -- test/buildRelease.test.js test/PotreeSourceRegression.test.js
```

外层项目也可直接调用 `node <Potree源码绝对路径>/scripts/build.mjs --target <目标目录绝对路径>`，不依赖调用者的工作目录。目标必须是专门保存产物、名为 potree 的目录，不得指向项目根目录或包含源码的目录。一次操作只同步指定目标。

`gulp build`、`gulp pack`、原有 `gulp build pack` 和 `npm start` 的 watch 重建均进入同一套版本流程。内部 assets/bundle 任务不作为发布入口；直接执行 Rollup 会提示使用完整构建。postinstall 保留构建行为，遵循相同规则：工作区干净时保持已提交版本，有未提交改动时准备候选版本，已有候选版本继续沿用。

## 产物与记录

每次完整构建等待所有资源流和 Rollup 成功完成后，生成源码根目录和 build/potree 中内容完全一致的 version.json。它记录版本、内容标识 buildId、UTC 构建时间、构建时的 Git HEAD/分支/未提交状态、已提交版本、Node 版本、锁文件摘要以及全部产物的路径/字节数/SHA-256。构建记录里的源码提交号指构建时 HEAD，不预先假定尚未创建的提交号。

buildId 使用版本、源码 HEAD 与产物摘要组合；同版本的不同内容可被识别。计算摘要时排除 version.json 自身。根目录 version.json 和构建锁不纳入 Git，历史由外层项目提交和 CI 构建产物保存。复制已有产物不会递增版本。

同步范围是 build/potree 整个目录，包括 JS、source map、CSS、HTML、workers、WASM、resources、lazylibs 和许可证。先复制到目标旁的临时目录，校验后替换专属目录，从而清理旧产物；替换失败时恢复原目录。不会同步其他外层项目，也不会覆盖 potree_libs 下的同级依赖。

Windows 的开发服务器可能持续占用目录句柄。有限重试后仍不能重命名时，先保留旧目录的完整备份，再按文件镜像更新并校验；失败时从备份恢复。此路径在复制期间不是原子切换，完成校验后才报告成功。

构建或同步失败会恢复原 package/lock 版本、根目录记录和上次本地产物。构建锁防止同一源码仓库并发构建。如果进程被强制终止，确认锁中 PID 已退出后才能删除遗留锁。

外层项目对最终发布目录进行二次处理时，需要自行说明差异。例如删除 source map 后，完整分发清单不能再用于验证该裁剪目录；public 中同步的原始目录仍须通过完整校验。
