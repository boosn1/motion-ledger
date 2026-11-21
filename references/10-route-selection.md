# 10 · 技术路线自动选择准则

两条路线都能出片，能力不等价。这份文档把「选哪条」从口味变成**可执行判断**：读完不需要回忆任何对话，照着跑就能得到结论。

> 本文件的全部数字来自 2026-11-21 的一次真实项目（《星光 · 延时》75s / 1920×1080 / 30fps），不是估算。

---

## 0. 先跑前置检查，再谈选哪条

**踩过的坑**：开工时只查了系统级 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`）不存在，就判定「Remotion 不可用」，改用自写光栅路线。实际上 Remotion 自带浏览器，`templates/remotion-starter/node_modules` 里已经装好了 152 个包和 260 MB 的 `chrome-headless-shell`。

**所以第一步永远是这三条命令，不许凭印象**：

```powershell
# ① 依赖装没装
Test-Path templates/remotion-starter/node_modules

# ② Remotion 自带的浏览器在不在（关键：不要只查系统 Chrome）
Get-ChildItem templates/remotion-starter/node_modules/.remotion/chrome-headless-shell -Recurse -Filter chrome-headless-shell.exe |
  Select-Object FullName, Length

# ③ 真渲染 30 帧（能出片才算可用，能装不算）
cd templates/remotion-starter
$env:TEMP = Join-Path $PWD ".rtmp"; $env:TMP = $env:TEMP
npx remotion render Film out/probe-route.mp4 --scale=0.25 --frames=0-30
```

三条全过 → **Remotion 可用**。任何一条不过，再走下面的降级判断。

`$env:TEMP` 那两行不是可选：Remotion 默认把编译缓存写到系统 temp，某些机器上会被权限策略拦住；指到项目内的 `.rtmp/`（已在 `.gitignore`）能绕开。

---

## 1. 决策表（判断条件 → 选择结果）

按顺序问，**第一个命中就停**：

| # | 判断条件 | 选择结果 |
|---|---|---|
| 1 | 前置检查第 ① 或 ② 不过（装不了 npm / 无 headless 浏览器） | **node-starter**（`@napi-rs/canvas` + ffmpeg 逐帧） |
| 2 | 画面主体是「遮罩擦除 / 布尔差集 / 自定义光栅 / 逐像素处理」 | **node-starter** |
| 3 | 1920×1080 且时长 > 60s 且预计改稿 ≥ 5 轮 | **node-starter**（速度差 3–5 倍，改稿次数是乘数） |
| 4 | 画面主体是「文字排版 / 多栏布局 / 复杂 CSS / 需要 google-fonts」 | **Remotion** |
| 5 | 必须复用官方模板结构（`spec.ts` + `Film.tsx` + `scenes/`）或需要 `spring()` / `interpolate()` | **Remotion** |
| 6 | 以上都不命中 | **Remotion**（默认，模板齐、交付链照它写） |

第 6 条的意思是：**没有明确理由时选 Remotion**，因为 `concat-bridge.mjs --subs-from-spec`、`SUBS` 的解析正则、`MASTER_VOL` 的补偿值全是照 Remotion 模板写的。选 node-starter 意味着你要自己保证 `spec.mjs` 里的 `SUBS` 形态与之一致（见 §5）。

---

## 2. 六个维度的实测对照

### 2.1 渲染引擎可用性

| | Remotion | node-starter |
|---|---|---|
| 依赖 | npm（Remotion 4.0.545 + React 19，152 包） | 零 npm（`@napi-rs/canvas` 是可选的；模板自带纯 Node 光栅器） |
| 浏览器 | **自带** `node_modules/.remotion/chrome-headless-shell`（260 MB），不依赖系统 Chrome | 不需要 |
| 首次可用时间 | `npm install` 约 1 分钟 | 立刻能跑 |
| 常见失败 | `$env:TEMP` 指向不可写目录 → 编译缓存写不进去 | 无（除非 `@napi-rs/canvas` 的 native binding 与 Node ABI 不匹配） |

**结论**：「本机没有 Chrome」**不是** Remotion 不可用的理由。只有 `node_modules/.remotion/` 里也没有 headless shell 时才是。

### 2.2 遮罩擦除与差集类效果

这是两条路线差距最大的一项。

| 效果 | Remotion | node-starter（Canvas 2D） |
|---|---|---|
| 文字逐字升入 / 擦除 | SVG `<clipPath>` 或 CSS `clip-path`，要为每个字算一个矩形 | `ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();` 一行 |
| 两圆差集（月牙暗面） | `<path>` 用 `fill-rule="evenodd"`，要手写 path 数据 | 两圆反向绕行，`ctx.fill()` 用 nonzero winding 自动出环 |
| 环带（有宽度的圆环） | 两条 path 拼，或用 `mask` | 外圈顺时针 + 内圈逆时针，一次 `fill()` 出真差集（不是透明度假装） |
| 逐像素处理 | 不行（DOM 渲染） | 直接写 `ImageData` |

本项目 42.7s 那个「光壳」——8 层有宽度的圆环，带宽从 24px 收到 1.6px——在 Canvas 里是：

```js
function bandFill(ctx, pts, w, color, alpha) {
  const inner = pts.map(p => { const k = Math.max(0, 1 - w / len); return { x: cx + (p.x-cx)*k, y: cy + (p.y-cy)*k }; });
  poly(ctx, pts, { fill: color, alpha });            // 外圈顺时针
  poly(ctx, inner.reverse(), { fill: color, alpha }); // 内圈逆时针 → 挖空
}
```

换成 Remotion 要生成两段 SVG path 并处理 `fill-rule`，且带宽是动态值时每帧都要重算 path 字符串。

**结论**：效果清单里出现「遮罩」「差集」「环带」「逐像素」任一项，node-starter 省的时间不是一点。

### 2.3 CJK 排版

| | Remotion | node-starter（Canvas 2D） |
|---|---|---|
| 字体加载 | `@remotion/google-fonts` 或 `staticFile` + `FontFace` | `GlobalFonts.registerFromPath('C:/Windows/Fonts/NotoSansSC-VF.ttf', 'NotoSC')` |
| 自动换行 / 行高 | 浏览器负责，写 CSS 即可 | 要自己 `measureText` 拆行 |
| 字距（tracking） | `letter-spacing` 一行 | 逐字 `fillText` 累加 advance，自己实现 |
| 对齐 | `text-align` | 先 `measureText` 算总宽，再决定起点 |
| 基线 | 自动 | 手动；**数字与单位要对基线，不能对底边**（差 1px 就看得出来） |
| 大字号标点 | 正常 | **CJK 中点「·」在大字号下会渲成实心圆饼**，必须拆成两段文字 + 独立圆点 |

**结论**：文字量大、需要换行与复杂对齐 → Remotion。只有「十几句大字 + 几个数字」这种量级，node-starter 的自写排版才划算（本项目就是：11 句文案 + 3 段读数 + 5 个刻度标签）。

### 2.4 逐帧确定性

两条路线**要求完全一样**，来自 `04-engineering-contract.md`：

- 禁 `Date.now()` / `Math.random()` / `setTimeout()` / `setInterval()` / 帧间 state / CSS 动画。
- 一切运动写成 `t` 的闭式解；随机数用 `makeRand(seed)`，种子从索引派生（`seed = index * 7919`）。

差异只在「时间从哪来」：

- Remotion：`useCurrentFrame()` / `useTime()`，**帧号由渲染器给**。
- node-starter：`const t = i / fps;`，**帧号由你的 pump 循环给**。

**结论**：确定性不是选路线的理由，两条都能做到。但如果片子依赖「上一帧的状态」（粒子、流体、累积位移），两条都不许用——必须换成闭式解。

### 2.5 渲染速度（实测，1920×1080）

| | 速度 | 75s 片子耗时 |
|---|---|---|
| Remotion（`--scale=0.25` 探针） | 约 5–15 fps（取决于画面复杂度） | 约 3–8 分钟 |
| node-starter + `@napi-rs/canvas` | **43–53 fps** | 约 45–52 秒 |

差 3–5 倍。改稿 10 轮就是 40 分钟 vs 8 分钟。

**结论**：长片 + 多轮改稿 → node-starter。一次性交付、只改 1–2 轮 → Remotion 的速度劣势可以接受。

### 2.6 与官方模板结构的契合度

| 官方资产 | 照谁写的 | node-starter 能不能用 |
|---|---|---|
| `spec.ts` 的 `FILM/COLOR/TYPE/SUBS` 结构 | Remotion | **能**，写 `spec.mjs` 同形即可；`parseSpec` 认 `const FILM = {...};` 单行字段形式 |
| `concat-bridge.mjs --subs-from-spec` | Remotion（`spec.ts`） | **能**，但 `parseSubsFromSpec` 的正则只认 `[[数字, 数字, '文案']]`，`spec.mjs` 里必须手写这个形态 |
| `Film.tsx` 的 `MASTER_VOL` 补偿 | Remotion（渲染固定压 3.2dB） | **不能直接套**：node-starter 走 rawvideo pipe，不压音频，不需要补偿 |
| `verify/film.mjs` 门禁 | 通用 | **能**，`--spec` 传 `src/spec.mjs` |
| `verify/spec.mjs` 门禁 | 通用 | **能**，扫 `src/` 下任意文件 |

**结论**：node-starter 复用官方模板时，**唯一需要手工对齐的是 `SUBS` 的形态**；`MASTER_VOL` 那套补偿不适用。

---

## 3. 混合策略（推荐）

不是二选一。本会话的最终做法是：

1. **正文用 node-starter 渲**（快、遮罩/差集顺手、改稿几十轮）。
2. **字幕交给 Concat**（`concat-bridge.mjs`，不烧进画面）——这样改字幕不用重渲，`SUBS` 改了只重跑桥接。
3. **交付电平用 ffmpeg 补**（`loudnorm` 两遍法），不依赖 Remotion 的 `MASTER_VOL`。

这套组合把「速度」和「官方交付链」都拿到了。代价是 `spec.mjs` 要手写 `SUBS`（见 §5）。

---

## 4. 一句话速查

```
装不了 npm 或没有 headless shell        → node-starter
遮罩 / 差集 / 环带 / 逐像素              → node-starter
1080p 且 >60s 且要改 5 轮以上           → node-starter
文字为主 / 多栏 / 复杂 CSS              → Remotion
要复用 Film.tsx 或 spring()/interpolate() → Remotion
以上都不命中                            → Remotion
```

---

## 5. node-starter 路线必须自己保证的三件事

官方模板的默认值是按 Remotion 写的，切到 node-starter 后这三处会静默不生效：

1. **`spec.mjs` 必须有 `SUBS`**，且形态是 `[[起始秒, 结束秒, '文案']]`：

```js
export const SUBS = [ // E08 S18 S19
  [8.6, 11.8, '光，要走很久'],
  [22.6, 25.6, '光在路上走了 640 年'],
];
```

漏了它，`--subs-from-spec` 会读到空数组，桥接脚本不报错、只是没有字幕。

2. **字幕不要复述画面大字**。本项目第一版把 10 句大字逐句搬进字幕轨，导出后抽帧才发现是重影：画面左侧已有「若它在 1400 年爆发 / 我们要到 2040 年才知道」，底部字幕又打一遍。字幕只承担大字**没说**的连接词。改完剩 4 条。

3. **门禁要从仓库根跑**。`verify/film.mjs` 用相对路径找 `ffmpeg`/`ffprobe` 与台账，在 `templates/node-starter/` 里跑会 `MODULE_NOT_FOUND`：

```powershell
# 对：从仓库根
node verify/film.mjs --film templates/node-starter/out/film.mp4 `
  --spec templates/node-starter/src/spec.mjs --ledger templates/node-starter/LEDGER.md

# 错：cd templates/node-starter 之后跑
```

---

## 6. 本准则自身的维护

- 新增一条判断条件时，必须同时给出**可执行的检查命令**，否则它会在下一次变成「凭印象」。
- 速度、包数、文件大小这类数字会随版本变，改动时重新实测并更新 §2.5 与 §2.1，不要照抄。
