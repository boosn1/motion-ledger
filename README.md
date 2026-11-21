# motion-ledger · 台账驱动的动效制作 Skill

**中文** · [English](README.en.md)

> 让任何模型（包括较弱的模型）做出接近强模型的代码动效片。
> 不靠"审美提示"，靠**三张台账**把模糊需求变成精确值，靠**代码门禁**把"感觉不错"变成 PASS/FAIL。

---

## 这个项目解决什么问题

强模型和弱模型做同一段动效提示词，差距不在审美，在**行为**。强模型会：

1. 照做提示词里的每一个数值（时长、颜色、字号、角度、缓动）
2. 把模糊描述（"高级感""有呼吸感"）变成具体的设计决定
3. 每个元素都认真设计，不交 helper 的默认方盒子
4. 先排时间线，再写代码
5. 建一套统一的系统（颜色索引、槽位常量、材质渲染器），而不是每个场景各写一遍
6. 做完回头自查，把不对的地方修掉

弱模型这 6 件事**全跳过**，而且跳得毫无自觉——它交出来的东西能跑，但像模板。

`motion-ledger` 把这 6 件事变成**不可跳过的显式步骤**，并且用代码检查它们是否真的做了。

---

## 四层结构

```
┌─ 1 纪律层 ───────────────────────────────────────────────┐
│  三张台账 S/X/E · 时间线先于代码 · 台账 id 回写源码        │
│  产出 LEDGER.md              审计 verify/spec.mjs         │
├─ 2 工艺层 ───────────────────────────────────────────────┤
│  时值表（120–220 / 350–650 / 600–1200 / 900–1800ms）      │
│  视觉语法四类 · 注意力三层 · 单一材质世界逻辑             │
│  9 类元素 playbook · 6 条通用规则 · 声音政策              │
│  产出 spec.ts + scenes/      审计 禁用项扫描 + 五维复审    │
├─ 3 门禁层（本项目原创，别人没有的）───────────────────────┤
│  verify/film.mjs   MP4 体检：格式/首帧/循环/运动曲线/反PPT │
│  verify/spec.mjs   台账覆盖率 + 占位符 + 禁用项源码扫描    │
│  产出 PASS/FAIL + out/check/ 审计 verify/selftest.mjs      │
├─ 4 交付层 ───────────────────────────────────────────────┤
│  字幕 · 多轨 · 转场 · 配音对齐 · 混音 · 按平台改比例       │
│  产出 final.mp4              审计 ffprobe + 抽帧目视       │
└──────────────────────────────────────────────────────────┘
════════════════ 地基（不属于任何一层）════════════════════
  src/lib/motion.tsx   决定「东西在哪、怎么动」，不决定「长什么样」
  时间/缓动/节拍 · 逐点变形 morphPts · 角色骨架 rig · 组件
  → 它是机制不是设计，所以不进四层；也正因如此它不许改
═══════════════════════════════════════════════════════════
```

**关键差异**：市面上同类 skill 的验收都是"让模型给自己打分"，天然有确认偏差。本项目把能代码判定的部分**全部代码化**——运动曲线、反 PPT 门禁、台账覆盖率、禁用项扫描，这些不靠模型自觉。

**为什么 `motion.tsx` 不在四层里**：四层都在回答"这支片该是什么样"，而它回答的是"给定时间 t，一个点该在哪"。那是机制不是设计。它一旦改了，门禁的读数就不再可比——`film.mjs` 量的运动曲线、`EASE.*` 的闭式解、`rand` 的种子复现性全部失效。所以它被划成不许改的地基。

每一层管什么、不管什么、边界在哪，以及**为什么是四层不是三层或五层**，见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（中英双语）。

---

## 怎么用（三步）

### 第 1 步：装

**DeepSeek Harness 的技能目录是 `~/.dsh/skills`（Windows：`D:\Users\<你>\.dsh\skills`）**：

```bash
git clone git@github.com:boosn1/motion-ledger.git ~/.dsh/skills/motion-ledger
```

其他宿主按各自的根目录放：`.claude/skills`、`.agents/skills`、项目内 `.dsh/skills`。
要求：`SKILL.md` 必须有非空 `name` 与 `description` frontmatter，否则会被静默忽略。

依赖：

| 依赖 | 用途 | 必需 |
|---|---|---|
| Node.js ≥ 22 | 门禁脚本、配乐合成 | 是 |
| ffmpeg + ffprobe | 抽帧、运动曲线、音频检测 | 门禁需要 |
| npm | 装 Remotion（仅 Remotion 路线） | 视路线 |

### 第 2 步：复制 starter 开一个新片子

```bash
cp -R motion-ledger/templates/remotion-starter my-film
cd my-film
npm install
```

starter 是一个**能跑通的完整片子**：15 秒品牌片，五个方块 → 聚成环 → 拉成横条字标。
它同时是格式范例——`LEDGER.md` 里写着配套台账，`src/spec.ts` 里每个常量都带 `// S01` 这样的回写注释。

```bash
npm run studio     # 打开 Remotion Studio 实时预览
npm run render     # 出 out/film.mp4
npm run check      # 抽帧 + 运动曲线 + 音频自查
npm run score      # 重新合成配乐
```

> **Windows 注意**：Remotion 自带的 ffmpeg 有时写系统 TEMP 会被拒（`FFmpeg quit with code 4294967283`）。
> 把临时目录指到工作区内即可：
> ```powershell
> $env:TEMP = "$PWD\.rtmp"; $env:TMP = $env:TEMP; npm run render
> ```

### 第 3 步：让 agent 按 SKILL.md 干活

对 agent 说：**「读 motion-ledger/SKILL.md，按它的流程做这个片子：<你的提示词>」**

然后它会走这七步：

| 阶段 | 产出 | 门禁 |
|---|---|---|
| 0 记账 | `LEDGER.md` 三张表（S 需求 / X 变形 / E 元素） | — |
| 1 补白 | 提示词没写的用默认值表补，标 `S##*` | — |
| 2 风格 | 定一种材质世界逻辑 + 3–5 色调色板 | — |
| 3 时间线 | 事件表（每行 `t: 元素 · 动作 · 数值 · id`） | 节拍检查 |
| 4 设计 | 关键构图 px 级定死，先静态后运动 | — |
| 5 构建 | 写 `spec.ts` / `scenes/` | `npm run render` |
| 6 验收 | 跑门禁 + 一次有界复核 | `spec.mjs` + `film.mjs` |

**每做一个新片子必须新开一个对话。** 老对话里模型会沿用上一版的代码，新台账用不上——这是这类 skill 最容易被忽略的失效点。

---

## 门禁怎么跑

门禁是独立脚本，任何时候都能单独跑，不需要 agent：

```bash
# MP4 体检：格式对 spec / 首帧无闪色 / 循环接缝 / 运动曲线 / 反 PPT 死区 / 音频非静音
node verify/film.mjs --film out/film.mp4 --spec src/spec.ts --ledger LEDGER.md

# 台账审计：覆盖率 / 未记账常量 / starter 占位符残留 / 禁用项
node verify/spec.mjs --ledger LEDGER.md --src src/

# 门禁自测：证明门禁会红也会绿，不是摆设
node verify/selftest.mjs

# 两份 score.mjs 有没有分叉（starter 必须自包含，所以故意留两份）
node verify/sync.mjs
```

这四个脚本只依赖 Node 内置模块 + ffmpeg，**无 npm 依赖，无 node_modules**。

**为什么 `score.mjs` 有两份却不算冗余**：`templates/` 下的每个 starter 都要能 `cp -R` 出来独立工作，不能有指回仓库根的相对 import。所以两份是故意的——`verify/sync.mjs` 比对它们的 sha256，分叉了就报错，用脚本防漂移而不是合并。

`selftest.mjs` 在系统临时目录造夹具跑 11 条断言（正例必绿、反例必红、放宽参数必生效），不往仓库写任何东西。
**换机器、换平台后先跑它**——它能立刻告诉你门禁在这个环境下是否还有效。

### 门禁是「声明式」的，不是硬判

任何真实形变都会超过「4× 中位帧差」的阈值。硬判必然误杀，所以峰值与静止**由台账声明、代码只核对声明**：

```markdown
### 计划内运动峰值
| 区间 | 来源 | 为什么允许 |
|---|---|---|
| 2.50–4.20 | X01 | 方块变弧，形状变化最剧烈 |

### 计划内静止
| 区间 | 来源 | 为什么允许 |
|---|---|---|
| 11.60–15.00 | S18 结尾 hold | 字标落定后停住，让观众读完 |
```

台账没写这两张表 = 严格模式，任何尖峰/死区都算 bug。这个设计的要点是：**"这一下动得对不对"只有作者知道，代码只负责抓"你没声明就动"**。

---

## 能做什么（按把握度排序）

把握度不是感觉，是**可验证的原因**：能逐帧确定、能被台账追溯、能被门禁核对的部分把握最高。

| 类型 | 把握 | 为什么 | 典型时长 |
|---|---|---|---|
| 品牌/产品动效片 | **最大** | 元素有明确来路去处，代码逐帧确定，无漂移；构图可 px 级定死 | 15–60s |
| 数据动画 / 图表变形 | **很大** | 数值全部原文引用台账，门禁查覆盖率；变形走共享槽位不丢身份 | 15–40s |
| 动态文字 / Logo 演绎 | **很大** | 矢量无模糊边界，CJK 竖排与字距能算准，`<Letters>` 逐字可控 | 5–30s |
| 讲解片 / Explainer | **中上** | 有旁白时间轴时按词级排镜；纯手绘插画风格做不了 | 60–120s |
| UI / 产品演示 | **中** | 必须真截图（PageCam 式 2.5D 相机）；手搓假界面一眼假 | 15–40s |
| 风格化艺术动画 | **中** | 纸墨/半调/拼贴/版画可以；真厚涂油画不行 | 10–40s |
| 角色短片 | **最低** | 能走位能换姿势，保证不了表演（原项目自测相似度仅 0.40–0.49） | 不确定 |

对照：同一套流程下，数据动画相似度 **0.85–0.96**、文字类 **0.79–0.94**、多材质 **0.68–0.89**、角色故事 **0.40–0.49**。

**不能做**：真人拍摄、剪辑现成素材、写实画面生成（用图像模型）、语音合成、2 分钟以上的长叙事。

一条判断规则：**难点是「精确」还是「质感」？** 精确（数值、形状、卡拍、跨镜一致）→ 这套流程赢；质感（像画的、像拍的、有笔触）→ 这套流程输，该接图像模型。两类混在一起就分开做：质感的用模型出素材，精确的用代码排布。

完整清单、成本估计与边界见 [`references/09-capabilities.md`](references/09-capabilities.md)。

---

## 成片之后：接剪辑器

代码出画面，剪辑器管时间线与文字。有 Concat（0.2.12+）时：

```bash
node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 \
  --caption "静水流深" --caption-start 0.6 --caption-dur 3.0
```

实测输出：

```
Concat 0.2.12 · D:\Program Files\Concat\concat.exe
导入 m1 · 15.019s · 1920×1080
字幕「静水流深」· 0.6–3.6s
交付 final.mp4 · 847551 bytes
```

**Concat 是第 4 层（交付层）的一个实现，不是第 5 层，也不替代第 1–3 层。**
不要用它替代 Remotion——那是用剪辑软件画动画，每帧手工摆位置，回到没有台账没有门禁的老路。也不要指望 Remotion 做字幕排版和配音对齐。分工见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#concat-在哪一层起什么作用) 与 [`references/08-delivery.md`](references/08-delivery.md)。

没有 Concat 也能交付：`ffmpeg -vf subtitles=` 烧硬字幕、`-i voice.wav -shortest` 接配音、`-f concat` 拼接。**层不会消失，只是实现换了。**

### 配乐被说「嗡嗡」时：先分轨，别猜

成片只有一条混好的音轨，答不了「这个声音是哪来的」。`--stems` 把配乐按耳朵能分辨的层拆开：

```bash
node scripts/score.mjs --cues scripts/cues.json --out public/score.wav --stems
```

```
  层          峰值dBFS   RMS dBFS   占比
  pad           -8.9    -22.7    14.5%
  sub           -7.8    -18.2    41.0%
  bassPluck     -7.0    -21.3    20.0%
  kick           1.5    -21.9    17.6%
  hat          -19.8    -45.0     0.1%
  ...
```

**这张表就是结论**：81% 能量压在低频四层，`pad` 只有 14.5%、`hat` 只有 0.1%——「嗡嗡」只可能来自那四层。要逐轨试听就铺进 Concat（一层一条轨，视频轨自动静音、空轨自动删掉）：

```bash
node scripts/concat-bridge.mjs --film out/film.mp4 --stems public/stems \
  --subs-from-spec src/spec.ts --out final.mp4
```

一条命令出齐视轨 + 每条分轨一条音轨 + 一条字幕轨。只想在 GUI 里试听不要成片，加 `--no-export`。

哪一层一关嗡嗡就没了，问题就定位到那一层。五种真凶与判断口径见 [`references/06-sound.md`](references/06-sound.md)。

---

## 改完就推（纪律）

```bash
node scripts/publish.mjs          # 门禁 → 悬空引用检查 → 提交 → 推送
node scripts/publish.mjs --dry    # 只检查不提交
```

门禁不过就拒绝提交——**坏的门禁比没有门禁更糟**，它会让后面所有结论都不可信。

推完同步到 DSH 技能目录（否则本地技能中心还是旧版）。**在仓库根目录执行**：

```powershell
$src = (Get-Location).Path        # 不写死盘符：换个目录 clone 下来照样能用
$dst = Join-Path $env:DSH_HOME "skills\motion-ledger"   # 本机 DSH_HOME 在 D 盘，别硬编码 C:\Users\<你>\.dsh
Remove-Item -Recurse -Force $dst -ErrorAction SilentlyContinue
& "C:\Program Files\Git\cmd\git.exe" -C $src ls-files | ForEach-Object {
  $t = Join-Path $dst $_
  New-Item -ItemType Directory -Force (Split-Path $t) | Out-Null
  Copy-Item (Join-Path $src $_) $t
}
```

---

## 目录

```
motion-ledger/
├── SKILL.md                        ← agent 读这个（主入口）
├── docs/
│   └── ARCHITECTURE.md             四层架构、每层边界、Concat 位置（中英双语）
├── references/
│   ├── 01-ledgers.md               三张台账的完整规则
│   ├── 02-playbooks.md             9 类元素：怎么建 / 怎么动 / 常见失败
│   ├── 03-timing-and-grammar.md    时值表、视觉语法、注意力编排、美术方向
│   ├── 04-engineering-contract.md  三栈契约（Remotion / HTML+GSAP / node-starter）+ 确定性规则
│   ├── 05-review.md                五评委 → 代码门禁映射、独立复审、禁用清单
│   ├── 06-sound.md                 声音政策与配乐规格
│   ├── 07-competitive-map.md       同类项目横向对比（选型依据）
│   ├── 08-delivery.md              交付层：字幕/多轨/混音/Concat 桥
│   ├── 09-capabilities.md          能做什么、不能做什么、成本估计
│   ├── 10-route-selection.md       两条渲染路线怎么选（判断条件 → 结果，含前置检查命令）
│   └── 11-pitfalls.md              踩坑清单：A 路线/B 门禁/C 动效/D 音频/E 交付/F 排版/G 诊断/H 仓库
├── scripts/
│   ├── concat-bridge.mjs           成片 → Concat 剪辑器（加字幕、导出）
│   └── publish.mjs                 门禁 → 提交 → 推送（一条命令）
├── verify/                         ← 门禁（零依赖）
│   ├── film.mjs                    MP4 体检
│   ├── spec.mjs                    台账与源码审计
│   ├── selftest.mjs                门禁自测（11 条断言）
│   ├── sync.mjs                    两份 score.mjs 是否仍一致（防漂移）
│   └── lib.mjs                     共用工具
├── templates/
│   ├── remotion-starter/           ← 主推：Remotion + React + SVG（已跑通出片）
│   │   ├── LEDGER.md               配套台账（抄这个格式）
│   │   ├── src/spec.ts             设计常量（带 // S01 回写注释）
│   │   ├── src/lib/motion.tsx      helper 库（不许改）
│   │   ├── src/geometry.ts         形状几何（真变形的技术核心）
│   │   ├── src/scenes/             场景（绝对 t，窗口外 return null）
│   │   ├── scripts/score.mjs       零依赖配乐合成
│   │   └── scripts/check.mjs       项目内自查
│   └── node-starter/               ← 备选：纯 Node 光栅器，零 npm 依赖
│       ├── LEDGER.md               配套台账
│       ├── src/spec.mjs            设计常量
│       ├── src/lib/motion-core.mjs 机制库（不许改）
│       ├── src/raster.mjs          光栅原语（多边形/环带/描边）
│       ├── src/film.mjs            场景（逐帧画）
│       ├── src/render.mjs          出帧 → ffmpeg
│       └── scripts/score.mjs       配乐（与 remotion 版同源）
├── examples/
│   └── LEDGER.example.md           台账范例（教学用：带解释与对账结果）
├── ATTRIBUTION.md                  上游来源与许可
├── PUBLISH.md                      推送与排错
├── README.en.md                    English
└── LICENSE                         MIT
```

**两份台账不要混**：`examples/LEDGER.example.md` 是**教学范例**（带逐条解释、回写源码示例、对账结果），`templates/*/LEDGER.md` 是**门禁输入**（真实片子用的，含峰值/静止声明表）。要抄格式抄后者，要理解规则读前者。

**两条渲染路线怎么选**（完整决策表与实测对照见 [`references/10-route-selection.md`](references/10-route-selection.md)）：

- **Remotion**（`templates/remotion-starter`）——有 Studio 实时预览、组件化、字体生态、生产用得多。要 `npm install`。**自带 headless 浏览器**（`node_modules/.remotion/chrome-headless-shell`），不依赖系统 Chrome——所以「本机没装 Chrome」不是不用它的理由。
- **纯 Node / Canvas 光栅**（`templates/node-starter`）——零依赖、直接出帧，适合无 npm 环境或要嵌进别的流水线。**遮罩擦除、布尔差集、环带、逐像素处理比 Remotion 顺手得多**（`ctx.clip()` 一行 vs 手写 SVG path）；1080p 实测 43–53 fps，比 Remotion 快 3–5 倍，长片多轮改稿时差别很大。

**先跑前置检查再选**，不许凭印象：

```powershell
Test-Path templates/remotion-starter/node_modules
Get-ChildItem templates/remotion-starter/node_modules/.remotion/chrome-headless-shell -Recurse -Filter chrome-headless-shell.exe
```

一句话速查：装不了 npm 或没有 headless shell / 遮罩差集环带为主 / 1080p 且 >60s 且要改 5 轮以上 → node-starter；文字为主 / 多栏 / 复杂 CSS / 要复用 `Film.tsx` 或 `spring()` → Remotion；**以上都不命中 → Remotion**（`concat-bridge` 与 `SUBS` 解析都是照它写的）。

门禁对两条路线都适用：`spec.mjs` 扫源码注释，`film.mjs` 只认 MP4。**门禁一律从仓库根调用**，node-starter 路线 `--spec` 传 `src/spec.mjs`。

---

## 适用范围

**适合**：Remotion（React + SVG）动效片、HTML+GSAP 动效片、品牌片、数据动画、动态文字、UI/产品演示、风格化艺术动画、15–60 秒的短片与 showreel。

**不适合**：写实画面生成（需要视频模型）、现成素材剪辑（用剪辑软件）、给已有视频加字幕、真人拍摄。

---

## 已知边界

- **角色戏是弱项**。纯代码画角色在"形象漂移"和"手不在道具上"两件事上很容易崩。需要有人物时，正解是**生图模型出帧 + 代码负责合成/换帧/材质**，不是硬画。
- **厚涂/油画质感纯代码做不出来**。能做出"像"，做不出"是"。需要质感时同上。
- **配乐是代码合成的**，音色简单。音乐要求高就后期换真配乐。
- **Remotion 许可**：个人免费；公司 ≤3 人免费；更大公司需购买 Remotion 公司许可。商用前自己确认。
- 门禁能判**结构与一致性**，判不了**美**。美学判断仍需人看，只是不再让制作者自己看。

---

## 来源与致谢

本项目的规则体系是对四个公开项目的**综合与改写**，并补上了它们都没有的代码门禁层。详见 [ATTRIBUTION.md](ATTRIBUTION.md)。

- [8533502-dev/deepseek-opus-motion-skill](https://github.com/8533502-dev/deepseek-opus-motion-skill)（MIT）— 三张台账、9 类 playbook、五评委、禁用清单的原始表述
- [nexu-io/open-design](https://github.com/nexu-io/open-design) `skills/motion-design`（Apache-2.0）— 时值表、视觉语法、注意力三层、声音政策、有界复核
- [alchaincyf/huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion)（MIT）— 反 PPT 门禁思路、独立复审机制
- [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)（Apache-2.0）— "制作者有确认偏差，首检不能交给自己"的验收纪律

## License

MIT。见 [LICENSE](LICENSE)。
