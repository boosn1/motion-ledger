# 推送到 GitHub

本机当前**没有 git**（`git` 不在 PATH），也没有 `gh` CLI 和 token。所以下面给两条路，任选一条。

---

## 路 A：装 git，用已有的 SSH key 推（推荐）

本机已有 SSH 密钥：

```
C:\Users\boosn\.ssh\id_rsa
C:\Users\boosn\.ssh\id_rsa.pub
```

### 1. 装 git

```powershell
winget install --id Git.Git -e --source winget
```

装完**关掉当前终端重开**（PATH 才生效），然后：

```powershell
git --version
```

### 2. 把公钥加到 GitHub

```powershell
Get-Content C:\Users\boosn\.ssh\id_rsa.pub
```

复制输出，粘到 GitHub → Settings → SSH and GPG keys → New SSH key。

验证：

```powershell
ssh -T git@github.com
```

看到 `Hi <你的用户名>! You've successfully authenticated` 就是通了。

### 3. 在 GitHub 建空仓库

网页上 New repository，名字 `motion-ledger`，**不要**勾 README / .gitignore / license（本地已有）。

### 4. 推

```powershell
cd "D:\Users\boosn\周国强工作\Deepseek Harness\临时\motion-ledger"

git init
git add -A
git commit -m "motion-ledger: 台账驱动的动效制作 skill + 代码门禁"
git branch -M main
git remote add origin git@github.com:<你的用户名>/motion-ledger.git
git push -u origin main
```

---

## 路 B：不装 git，网页上传

GitHub 空仓库页面有 **uploading an existing file** 链接，把整个 `motion-ledger` 文件夹拖进去即可。

注意：网页上传**保留不了空目录**，但本项目没有空目录，所以没问题。

---

## 推送前自查

```powershell
cd "D:\Users\boosn\周国强工作\Deepseek Harness\临时\motion-ledger"

# 1. 门禁自测必须全绿
node verify/selftest.mjs

# 2. 确认没有垃圾文件被带进去
Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\' } |
  Select-Object @{n='文件';e={$_.FullName.Replace((Get-Location).Path + '\','')}}, Length |
  Sort-Object 文件 | Format-Table -AutoSize
```

期望：只有 `README.md` / `LICENSE` / `.gitignore` / `ATTRIBUTION.md` / `SKILL.md` /
`references/*.md`（7 个）/ `verify/*.mjs`（4 个）/ `examples/LEDGER.example.md`。
**没有 `node_modules`，没有 `out/`，没有视频和图片。**

---

## 推完之后

1. 仓库设置里加 topics：`claude-skill` `agent-skill` `motion-design` `remotion` `video` `deepseek`
2. 简介写：`台账驱动的动效制作 skill：把弱模型的行为拉齐到强模型，并用代码门禁验收。`
3. 如果想让它被 skill 生态发现，可以在 README 顶部加一句「Install: 把整个仓库放进你的 skills 目录」。

---

## 后续维护建议

- **每次改 `verify/*.mjs` 后必须重跑 `node verify/selftest.mjs`**——门禁自己坏了比没有门禁更糟。
- 改 `SKILL.md` 的规则时，同步检查 `references/` 里有没有重复表述，避免两处说法不一致。
- 新增 playbook 类型时，同时更新 `02-playbooks.md` 和 `01-ledgers.md` 的 E 表类型列。
- 阈值（首帧差 6、SSIM 0.97、尖峰 4×中位、死区 1.5s）是经验值，改之前先跑 selftest 确认反例仍然会红。
