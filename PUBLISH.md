# 推送到 GitHub

## 当前状态（已经做好的部分）

| 项 | 状态 |
|---|---|
| 本地 git 仓库 | ✅ 已 `git init`，分支 `main`，1 个提交 `ac69836` |
| 提交内容 | ✅ 41 个文件 / 10281 行，无 `node_modules`、无 `out/`、无视频图片 |
| remote | ✅ 已设为 `git@github.com:boosn1/motion-ledger.git` |
| SSH 认证 | ✅ `Hi boosn1! You've successfully authenticated` |
| GitHub 上的空仓库 | ❌ **还没建** —— 这是唯一剩下的一步 |

`git ls-remote origin` 现在报 `ERROR: Repository not found.`，因为远端仓库还不存在。
**本机没有 `gh` CLI，也没有 `GITHUB_TOKEN`，所以创建仓库这一步必须由你在网页上做一次。**

---

## 只剩一步：建空仓库，然后推

### 1. 在 GitHub 建空仓库

打开 https://github.com/new ，填：

- Repository name: `motion-ledger`
- 可见性：随你（公开更符合 skill 的用途）
- **不要**勾 "Add a README file"、**不要**选 .gitignore、**不要**选 license
  （本地这三样都有，勾了会产生冲突，推的时候要先 pull）

### 2. 推

```powershell
cd "D:\Users\boosn\周国强工作\Deepseek Harness\临时\motion-ledger"
& "C:\Program Files\Git\cmd\git.exe" push -u origin main
```

> 如果 `git` 不在 PATH 里，就用上面这个绝对路径。
> 或者把 `C:\Program Files\Git\cmd` 加进 PATH 后重开终端。

预期输出：`branch 'main' set up to track 'origin/main'.` + `* [new branch] main -> main`

---

## 为什么不能自动建仓库

三条路都试过了：

1. **`gh` CLI** —— 本机没有，`winget install GitHub.cli` 需要额外授权且当前网络对 winget 源不稳定。
2. **`GITHUB_TOKEN` 环境变量** —— 没有设置。查过 `GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_PAT` / `GIT_TOKEN` 全空。
3. **git 凭据管理器 / `~/.netrc` / `~/.git-credentials`** —— 都不存在，`cmdkey /list` 里也没有 github 条目。

SSH key 只能用于**推送到已存在的仓库**，不能创建仓库——这是 GitHub 的权限设计，不是本机配置问题。

如果你愿意给一个带 `repo` scope 的 Personal Access Token，我可以直接用 API 建仓库并推完，全程不用你动手：

```powershell
# 把 token 设成环境变量，然后让我执行
$env:GITHUB_TOKEN = "ghp_xxx"
```

---

## 推送前自查（可随时重跑）

```powershell
cd "D:\Users\boosn\周国强工作\Deepseek Harness\临时\motion-ledger"
$git = "C:\Program Files\Git\cmd\git.exe"

# 1. 四条门禁 + 自测必须全绿
node verify/selftest.mjs
node verify/spec.mjs --ledger templates/remotion-starter/LEDGER.md --src templates/remotion-starter/src
node verify/spec.mjs --ledger templates/node-starter/LEDGER.md --src templates/node-starter/src
node verify/film.mjs --film templates/remotion-starter/out/film.mp4 --spec templates/remotion-starter/src/spec.ts --ledger templates/remotion-starter/LEDGER.md
node verify/film.mjs --film templates/node-starter/out/film.mp4 --spec templates/node-starter/src/spec.mjs --ledger templates/node-starter/LEDGER.md

# 2. 确认没有垃圾文件被带进去
& $git ls-files | Measure-Object -Line
& $git status --short
```

期望：`git status` 为空（工作区干净），`git ls-files` 41 行。

---

## 推完之后

1. 仓库设置里加 topics：`claude-skill` `agent-skill` `motion-design` `remotion` `video` `deepseek` `skill`
2. 简介写：`台账驱动的动效制作 skill：把弱模型的行为对齐到强模型，并用代码门禁验收。`
3. 如果想让 skill 生态发现它，README 顶部已经写了安装方式，不用改。

---

## 后续维护纪律

- **每次改 `verify/*.mjs` 后必须重跑 `node verify/selftest.mjs`**——门禁自己坏了比没有门禁更糟。这个自测的用处就是让「门禁失效」变成一条会红的断言。
- 改 `SKILL.md` 的规则时，同步检查 `references/` 里有没有重复表述，避免两处说法不一致。
- 新增 playbook 类型时，同时更新 `02-playbooks.md` 和 `01-ledgers.md` 的 E 表类型列。
- 阈值（首帧差 6、SSIM 0.97、尖峰 4×中位、死区 1.5s）是经验值，改之前先跑 selftest 确认反例仍然会红。
- **改了 `templates/` 下的 starter 后，重跑两条路线出片 + 门禁**，否则 README 里「已跑通」这句话会过期。
