# 推送到 GitHub

**日常不用读这份文档。改完东西跑一条命令就行：**

```powershell
node scripts/publish.mjs
```

它做四件事：跑全部门禁 → 查悬空引用 → 提交 → 推送。门禁不过就拒绝提交。

下面这份文档只解释两件事：这条纪律为什么存在，以及出问题时怎么查。

---

## 当前状态

| 项 | 状态 |
|---|---|
| 仓库 | ✅ https://github.com/boosn1/motion-ledger |
| 本地 git | ✅ 分支 `main`，跟踪 `origin/main` |
| remote | ✅ `git@github.com:boosn1/motion-ledger.git`（SSH） |
| SSH 认证 | ✅ `Hi boosn1! You've successfully authenticated` |
| 门禁 | ✅ selftest 11/11、两份 spec 对账、两份成片门禁全绿 |
| 最近提交 | 见 `git log --oneline -1`（本文件不写死，免得每次提交后自己就过期了） |

---

## 为什么要把「推送」做成一条命令

用户的要求原话是「每次更新优化完 skill，同步推送到 github，作为长期记忆」。

这句话靠记性是做不到的。人会忘，忘了之后仓库就停在某个旧版本，而 skill 的真正价值在于**它的规则是最新的**——一个过期三周的 `verify/lib.mjs` 比没有门禁更危险，因为它会给出自信的错误结论。

所以把它变成机械动作：**推送不是收尾礼节，是交付流程的最后一道门禁。**

---

## 一条命令做了什么

```
node scripts/publish.mjs
```

### 1. 跑全部门禁（5 项）

| 门禁 | 抓什么 |
|---|---|
| `verify/selftest.mjs` | 门禁自己还能不能红。11 条断言，正反例都有 |
| `verify/spec.mjs` × 2 | 台账写了但代码没兑现 / 代码有台账没记 |
| `verify/film.mjs` × 2 | 成片与 spec 不符、计划外尖峰、死区、静音 |

成片门禁标了 `optional`：没渲染过就没有 `out/`，那不算错（只是跳过）。**但如果你刚改了 `templates/` 又没重渲，请自己意识到「跳过」不等于「通过」。**

### 2. 查悬空引用

文档里用反引号包起来的**带目录的路径**必须真实存在。

这条不是洁癖。之前真出过事：`references/04-engineering-contract.md` 里写着「不许改 `src/lib/motion.tsx`」，而那个文件当时**根本不存在**——文档先行、实现没跟上，读者照着做会一头雾水。

只查带 `/` 的路径。裸文件名（`spec.ts`、`cues.json`）在正文里是泛指，强行解析只会产生噪声——第一版就是因此报了 19 个假阳性。

### 3. 提交

提交信息从改动文件自动归类（SKILL / 参考文档 / 门禁 / 模板 / 脚本 / 说明）。想自己写就 `-m "..."`。

### 4. 推送

推失败不吞错，原样打出来，并提示三条排查方向。

---

## 参数

```powershell
node scripts/publish.mjs                  # 完整流程
node scripts/publish.mjs --dry            # 只跑门禁和自查，不提交
node scripts/publish.mjs -m "改了什么"     # 自定义提交信息
node scripts/publish.mjs --skip-gates     # 跳过门禁（只在纯文档改动时用）
```

`--skip-gates` 是逃生口，不是常规路径。用它的时候你是在赌「我这次只改了错别字」——赌错了，坏的门禁就进仓库了。

---

## 出问题怎么查

### git 不在 PATH

本机的 git 在 `C:\Program Files\Git\cmd\git.exe`，没进 PATH。`publish.mjs` 会自己猜这个路径，所以**不需要**你配 PATH。

手动调用时用绝对路径：

```powershell
& "C:\Program Files\Git\cmd\git.exe" status
```

### SSH 报错

```powershell
& "C:\Program Files\Git\usr\bin\ssh.exe" -T git@github.com
```

期望输出 `Hi boosn1! You've successfully authenticated`（exit 1 是 GitHub 的正常行为，它不提供 shell）。

如果 SSH 路径含空格导致报 `C:Program: command not found`，用 `git config` 而不是环境变量：

```powershell
& "C:\Program Files\Git\cmd\git.exe" config core.sshCommand '"C:/Program Files/Git/usr/bin/ssh.exe"'
```

环境变量 `GIT_SSH_COMMAND` 会被空格拆词，`git config` 不会。

### 推送失败但提交已在本地

不用重做。网络恢复后直接 `git push` 即可——提交是持久的，推送只是同步。

### 第一次在新机器上配置

```powershell
$git = "C:\Program Files\Git\cmd\git.exe"
& $git config user.name "boosn1"
& $git config user.email "boosn1@users.noreply.github.com"
& $git config core.sshCommand '"C:/Program Files/Git/usr/bin/ssh.exe"'
```

不设 `user.email` 会报 `fatal: unable to auto-detect email address`。

---

## 为什么不能让脚本自动建仓库

建仓库需要 `repo` scope 的凭据，而 SSH key **只能推送到已存在的仓库**——这是 GitHub 的权限设计，不是本机配置问题。当时三条路都试过：

1. **`gh` CLI** —— 本机没有。
2. **`GITHUB_TOKEN` 环境变量** —— `GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_PAT` / `GIT_TOKEN` 全空。
3. **git 凭据管理器 / `~/.netrc` / `~/.git-credentials`** —— 都不存在，`cmdkey /list` 里也没有 github 条目。

所以建仓库这一步（一次性）由人在网页上完成，之后的推送全自动。

---

## 仓库设置建议

1. topics：`claude-skill` `agent-skill` `motion-design` `remotion` `video` `deepseek` `skill`
2. 简介：`台账驱动的动效制作 skill：把弱模型的行为对齐到强模型，并用代码门禁验收。`
3. README 顶部已有安装方式，不用改。

---

## 维护纪律（比脚本更重要）

脚本能保证「推上去的是门禁通过的版本」，但保证不了「改得对」。这几条要人记：

- **改 `verify/*.mjs` 后必须重跑 `node verify/selftest.mjs`。** 门禁自己坏了比没有门禁更糟——这个自测的用处就是把「门禁失效」变成一条会红的断言。
- **改 `SKILL.md` 的规则时，同步检查 `references/` 里有没有重复表述。** 两处说法不一致比只有一处更糟，因为读者不知道该信哪个。
- **新增 playbook 类型时，同时更新 `02-playbooks.md` 和 `01-ledgers.md` 的 E 表类型列。**
- **阈值（首帧差 6、SSIM 0.97、尖峰 4×中位、死区 1.5s）是经验值。** 改之前先跑 selftest 确认反例仍然会红。
- **改了 `templates/` 下的 starter 后，重跑两条路线出片 + 门禁。** 否则 README 里「已跑通」这句话会过期。
- **同步到 `D:\Users\boosn\.dsh\skills\motion-ledger\`。** 那是 DSH 实际读取 skill 的目录（`$DSH_HOME/skills`，本机 `DSH_HOME=D:\Users\boosn\.dsh`），仓库和它不一致时，agent 读到的是旧规则。

  > 注意盘符：本机 `DSH_HOME` 在 **D 盘**。查 `C:\Users\<你>\.dsh` 会得出「不存在」的错误结论——这个坑已经踩过一次。用 `$env:DSH_HOME` 拿，别硬编码。

最后一条可以机械化：

```powershell
# 用 git ls-files 逐文件复制，避免带进 node_modules / out / .git
$src = "D:\Users\boosn\周国强工作\Deepseek Harness\临时\motion-ledger"
$dst = Join-Path $env:DSH_HOME "skills\motion-ledger"
$git = "C:\Program Files\Git\cmd\git.exe"
cd $src
& $git ls-files | ForEach-Object {
  $t = Join-Path $dst $_
  New-Item -ItemType Directory -Force -Path (Split-Path $t) | Out-Null
  Copy-Item $_ $t -Force
}
```
