# 架构 · ARCHITECTURE

> 这份文档回答一个问题：**这个项目里每一层管什么、不管什么，边界在哪。**
> 判断一个需求该不该走这套流程，先看这里；具体怎么写代码，看 `SKILL.md` 与 `references/`。

---

## 一句话

**把「做一支代码动效片」拆成四层，每层的产出都可被下一层的代码检查。**

不是「一套提示词模板」，是**一条有审计点的流水线**。

---

## 四层

```
┌─ 1 纪律层 ───────────────────────────────────────────────┐
│  S/X/E 三张台账 · 时间线先于代码 · 台账 id 回写源码        │
│  产出：LEDGER.md                                          │
│  审计：verify/spec.mjs 查覆盖率                            │
├─ 2 工艺层 ───────────────────────────────────────────────┤
│  时值表 · 视觉语法四类 · 注意力三层 · 单一材质世界逻辑      │
│  9 类元素 playbook · 6 条通用规则 · 声音政策               │
│  产出：spec.ts 的数值 + scenes/ 的实现                     │
│  审计：禁用项扫描 + 五维复审                               │
├─ 3 门禁层 ───────────────────────────────────────────────┤
│  verify/spec.mjs  台账↔源码 双向对账                       │
│  verify/film.mjs  成片体检（格式/首帧/接缝/运动曲线/音频）  │
│  产出：PASS/FAIL 与证据文件（抽帧、拼图、运动曲线）        │
│  审计：verify/selftest.mjs 证明门禁自己会红也会绿          │
├─ 4 交付层 ───────────────────────────────────────────────┤
│  字幕 · 多轨 · 转场 · 配音对齐 · 混音 · 按平台改比例       │
│  产出：final.mp4                                          │
│  审计：ffprobe 验流 + 抽帧目视                             │
└──────────────────────────────────────────────────────────┘
════════════════ 地基（不属于任何一层）════════════════════
   src/lib/motion.tsx        纯 Node 路线：src/lib/motion-core.mjs
   时间 useTime/prog/settle · 缓动 EASE · 节拍 beats
   确定性随机 rand/wobble · 形状与逐点变形 morphPts/chain/converge
   角色骨架 rig/grip/poseMix/walk · 质感 roughFor
   组件 Stage/Reveal/Letters/Counter
   → 决定「东西在哪、怎么动」，永不决定「长什么样」
═══════════════════════════════════════════════════════════
```

---

## 每层的边界

### 1 纪律层：管「有没有漏」，不管「好不好看」

三张表回答三个不同的问题，混成一张必然漏：

| 表 | 问题 | 漏了的症状 |
|---|---|---|
| **S** 需求 | 用户要了**什么**？ | 数值/文案被改、禁令被违反，而没人发现 |
| **X** 变形 | 什么东西**变成**了什么？ | 用叠加/交叉淡化假装变形，观众觉得「不对但说不出」 |
| **E** 元素 | 画面里**每一个**被画的东西设计过吗？ | 交 helper 默认方盒子，全片像模板 |

**它不管**：这一版好不好看、该用什么颜色。那是工艺层和人的事。

### 2 工艺层：管「像不像那个东西」，不管「用户要什么」

时值、语法、注意力、材质——这一层是**判断力**，来自四个上游项目的综合。

**它不管**：需求是否被忠实执行。工艺层可以做出很漂亮但完全跑题的片子。

### 3 门禁层：管「能不能被证明」，不管「对不对」

这是本项目相对同类唯一的原创点。同类 skill 的验收都是**让模型给自己打分**，天然有确认偏差。

门禁只做**能代码判定**的事：

| 能判 | 不能判 |
|---|---|
| 时长/帧率/画幅与 spec 一致 | 这个转场美不美 |
| 台账每条都在源码里有 id | 这个配色高级不高级 |
| 源码没有禁用项（未记账渐变、glow、emoji、TODO） | 这段文案写得好不好 |
| 运动曲线没有**未声明**的尖峰 | 这个尖峰该不该有 |
| 没有长死区、循环接缝对得上 | 结尾该停几秒 |
| 有声音时音轨不是静音 | 配乐好不好听 |

**注意最后两列的关系**：门禁不判断「该不该」，它判断「你有没有声明」。

尖峰和静止是**声明式**的——台账写 `### 计划内运动峰值` 表，代码只核对「动的地方是不是都在你声明的区间里」。这样真实变形不会被误杀，而未声明的意外动作一定被抓。**这一下动得对不对只有作者知道，代码只负责抓你没声明就动。**

### 4 交付层：管「能不能发出去」，不管「画面长什么样」

成片 ≠ 交付物。真实交付还要字幕、多轨、转场、配音、混音、按平台改比例。

这些事在代码里做不是不能做，是**不值得**：改一个字要重渲整片（几分钟），而剪辑器里拖一下就好。

---

## motion.tsx 是什么，为什么它不属于任何一层

架构图底部那条「地基」就是它：`templates/remotion-starter/src/lib/motion.tsx`（374 行，纯 Node 路线对应 `src/lib/motion-core.mjs`）。

**它不产出任何设计决定，所以它不在四层里。** 四层的每一层都在回答「这支片该是什么样」——台账记需求、工艺定风格、门禁验对错、交付管出口。`motion.tsx` 一个都不回答。它回答的是另一个问题：

> **给定一个时间 `t`，一个点该在哪、一个角度该是多少。**

这是**机制**，不是**设计**。它的文件头第一句就写着：

```
// 它决定东西**在哪、怎么动**，永远不决定**长什么样**。
// 交付时不许把这里的中性默认值（方盒子、火柴人、系统字体）当成品。
```

### 它提供什么

| 组 | 导出 | 干什么 |
|---|---|---|
| 时间 | `useTime()` · `prog(t,start,dur,ease)` · `settle(t,fps,landing,{lead,dur,bounce})` | 把绝对秒变成 0–1 进度；落地时的过冲与回弹 |
| 缓动 | `EASE.linear/out/in/inOut/back` · `smooth` · `clamp` · `lerp` | 精确的缓动曲线（不用 Remotion 自带 `Easing.exp`，它起点不为 0 会漏隐藏图层） |
| 节拍 | `beats(bpm)` → `.beat/.at(n)/.bar(n)/.index(t)/.nearest` | 让事件落在拍上，而不是"大概那个位置" |
| 确定性随机 | `rand(seed)` · `makeRand` · `wobble(seed,i,t)` · `stepped(t,perSecond)` | 同 seed 恒同结果；替代 `Math.random()` |
| 形状 | `circle` · `polygon` · `line` · `toPath` · `drawOn` | 生成点序列 |
| **逐点变形** | `morphPts(a,b,p)` · `morphPath` · `chain(t,segs)` · `converge(t,items,target)` | **这条管线的技术核心**：同点数逐点插值 = 真变形，不是交叉淡化 |
| 颜色 | `shadeHex(hex,k)` | 同一色相的明暗，避免引入新颜色 |
| 角色 | `Body` · `Pose` · `rig` · `grip` · `nearSide` · `poseMix` · `walk` | 骨架解算；`grip()` 算出手在道具上的位置，`rig()` 保证脚落地 |
| 质感 | `roughFor(sizePx,strength)` | 按尺寸缩放墨边粗糙度（小字不糊，大字不僵） |
| 组件 | `Stage` · `Reveal` · `Letters` · `Counter` | 满屏容器、硬边擦除、逐字入场（保留空格）、数字滚动 |

### 为什么它必须"不许改"

因为它一旦变了，**门禁的结论就不再可比**。

- `film.mjs` 量的是运动曲线。如果每支片的缓动实现都不同，"4× 中位帧差"这个阈值就失去意义——上一支片的尖峰和这一支片的尖峰不是同一个东西。
- `EASE.*` 是闭式解（给定 `t` 直接算，不积分、不读前一帧）。Remotion 抽帧渲染要 seek 到任意时刻得到同一画面，任何积分式的实现都会在 seek 时错位。
- `rand/wobble` 是有种子的。换成 `Math.random()` 后同一段代码渲两遍不一样，门禁的抽帧比对全部失效。

**要改行为，改 `src/spec.ts` 的数值和 `src/scenes/` 的实现。** 那两处才是设计决定所在。

### 它在两条路线里的位置

| | Remotion 路线 | 纯 Node 路线 |
|---|---|---|
| 文件 | `src/lib/motion.tsx` | `src/lib/motion-core.mjs` |
| 依赖 | React + Remotion API（`useCurrentFrame`/`useVideoConfig`） | 零依赖，纯函数 |
| 组件 | 有（`Stage`/`Reveal`/`Letters`/`Counter` 返回 JSX） | 无（只有计算） |
| 数学层 | 完全相同 | 完全相同 |

两条路线的数学层是同一套（`morphPts`/`chain`/`converge`/`rig`/`EASE` 逐行对应）。差别只在"怎么把结果画出来"：一条交给 React 渲染 SVG，一条交给手写光栅器填像素。

### 一句话

**四层是"做决定"的流程，`motion.tsx` 是"执行决定"的地基。** 地基不参与决策，但地基一变，上面所有审计点的读数都不可比——所以它被划成不许改的那一部分。

---

## Concat 在哪一层，起什么作用

**Concat 是第 4 层（交付层）的一个实现，不是新的第 5 层，也不替代第 1–3 层。**

| | motion-ledger（1–3 层） | Concat（第 4 层） |
|---|---|---|
| 是什么 | 生成器 | 剪辑器 |
| 管什么 | 这一帧长什么样 | 时间线上有什么、什么时候出现 |
| 怎么改 | 改代码，重渲 | 拖时间线，导出 |
| 强项 | 精确数值、真变形、可复现、可门禁 | 字幕、多轨、转场、混音、快速试错 |
| 弱项 | 改一个时间点要重渲全片 | 画不出「五个方块逐点变成环」 |

**为什么不能反过来用它替代第 1–3 层**：那等于用剪辑软件画动画——每帧手工摆位置，没有台账、没有门禁、没有可复现性，回到这套流程要解决的问题本身。

**为什么它值得接**：第 4 层的活如果硬用代码做，会污染第 2、3 层——为了加一条字幕去改 `scenes/`，然后重跑门禁，然后发现运动曲线变了。这是层级混淆，不是勤奋。

接法是 `scripts/concat-bridge.mjs`：一条命令把成片导入、加字幕、导出。

```bash
node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 \
  --caption "静水流深" --caption-start 0.6 --caption-dur 3.0
```

**没有 Concat 时第 4 层不会消失**，只是换成 ffmpeg（`-vf subtitles=` 烧字幕、`-i voice.wav -shortest` 接配音、`-filter_complex xfade` 转场）。层还在，实现换了。

细节见 `references/08-delivery.md`。

---

## 一次完整的活，数据怎么流

```
用户提示词
   │  Stage 0  逐条抄成 S 表（原文引用，不转述）
   ▼
LEDGER.md ──── 每场图层表、事件表、计划内峰值/静止声明
   │  Stage 1–2  补白 + 定一种材质世界逻辑
   │  Stage 3  时间线（先于代码）
   │  Stage 4  关键构图 px 级定死
   ▼
src/spec.ts（每个常量带 // S07）  +  src/scenes/*.tsx（每个 builder 带 // E03）
   │  Stage 5  渲染
   ▼
out/film.mp4
   │  Stage 6  verify/spec.mjs（台账↔源码）
   │           verify/film.mjs（成片↔spec↔台账声明）
   ▼
PASS / FAIL + out/check/（抽帧、拼图、运动曲线、音频波形）
   │  可选：第 4 层
   ▼
final.mp4（字幕/多轨/混音）
```

**每一根箭头都是一个可以独立重跑的检查点。** 这是它和「一次性生成」的根本区别：出问题时能定位到**哪一层**坏了。

---

## 为什么是四层，不是三层或五层

- **去掉第 1 层**（只要工艺 + 门禁）→ 门禁没有对账对象，只能查通用规则（有没有 glow、有没有 TODO），查不出「用户要 15 秒你给了 10 秒」。
- **去掉第 2 层**（只要台账 + 门禁）→ 台账全对，画面还是像模板。台账管不漏，不管好看。
- **去掉第 3 层**（只要纪律 + 工艺）→ 回到「让模型自己说做完了」，也就是这个项目要修的那个坑。
- **加第 5 层**（比如「发布层」：上传平台、写文案）→ 那是运营，不是制作。放进来会让这套流程的边界模糊，而且每个平台的发布规则变得比制作本身还长。

四层刚好覆盖「想清楚 → 做出来 → 证明做对了 → 发出去」。

---

## 文件与层的对应

| 层 | 文件 |
|---|---|
| 1 纪律 | `SKILL.md` Stage 0–3 · `references/01-ledgers.md` · `examples/LEDGER.example.md` |
| 2 工艺 | `references/02-playbooks.md` · `03-timing-and-grammar.md` · `06-sound.md` |
| 3 门禁 | `verify/lib.mjs` · `spec.mjs` · `film.mjs` · `selftest.mjs` · `sync.mjs`（两份配乐脚本是否还一致）· `references/05-review.md` |
| 4 交付 | `scripts/concat-bridge.mjs` · `references/08-delivery.md` |
| **地基（不属于任何层）** | `templates/remotion-starter/src/lib/motion.tsx` · `templates/node-starter/src/lib/motion-core.mjs` — 机制，不是设计；不许改 |
| 横切 | `references/04-engineering-contract.md`（渲染契约，两层共用）· `07-competitive-map.md`（选型依据）· `09-capabilities.md`（该不该用这套） |
| 维护 | `scripts/publish.mjs`（改完即推）· `PUBLISH.md`（出问题时怎么查） |
| 总览 | `README.md`（中文）· `README.en.md`（English）· 本文件（架构与边界） |

---

# Architecture (English)

> This document answers one question: **what each layer owns, what it explicitly does not own, and where the boundaries are.**

## One sentence

**Split "make a code-rendered motion film" into four layers, where each layer's output is checkable by code from the layer below.**

This is not a prompt template. It is a **pipeline with audit points**.

## The four layers

```
1. DISCIPLINE  ── S/X/E ledgers · timeline before code · ledger ids written back into source
                  output: LEDGER.md          audit: verify/spec.mjs (coverage)
2. CRAFT       ── timing table · four visual grammars · three attention layers
                  one material world · 9 element playbooks · 6 general rules · sound policy
                  output: numbers in spec.ts + implementation in scenes/
                  audit: forbidden-pattern scan + five-dimension review
3. GATES       ── verify/spec.mjs  ledger ↔ source, both directions
                  verify/film.mjs  film health (format / first frames / loop seam / motion curve / audio)
                  output: PASS/FAIL + evidence files (stills, contact sheet, motion curve)
                  audit: verify/selftest.mjs proves the gates can go red as well as green
4. DELIVERY    ── subtitles · multi-track · transitions · voice alignment · mix · platform ratios
                  output: final.mp4          audit: ffprobe stream check + visual spot check
════════════════ FOUNDATION (belongs to no layer) ════════════════════
   src/lib/motion.tsx        pure-Node route: src/lib/motion-core.mjs
   time useTime/prog/settle · easing EASE · beats beats
   deterministic random rand/wobble · shapes and point-wise morph morphPts/chain/converge
   character rig rig/grip/poseMix/walk · texture roughFor
   components Stage/Reveal/Letters/Counter
   → decides WHERE things are and HOW they move; never WHAT they look like
══════════════════════════════════════════════════════════════════════
```

## What motion.tsx is, and why it belongs to no layer

The foundation strip at the bottom of the diagram is `templates/remotion-starter/src/lib/motion.tsx` (374 lines; `src/lib/motion-core.mjs` on the pure-Node route).

**It produces no design decision, which is why it sits outside the four layers.** Every layer answers "what should this film be" — the ledger records the brief, craft fixes the style, gates prove correctness, delivery handles the exit. `motion.tsx` answers none of those. It answers a different question:

> **Given a time `t`, where is a point, and how large is an angle.**

That is *mechanism*, not *design*. Its own header says so:

```
// It decides WHERE things are and HOW they move; it never decides WHAT they look like.
// Do not ship its neutral defaults (plain boxes, stick figures, system fonts) as the finished look.
```

### What it provides

| Group | Exports | Purpose |
|---|---|---|
| Time | `useTime()` · `prog(t,start,dur,ease)` · `settle(t,fps,landing,{lead,dur,bounce})` | absolute seconds → 0–1 progress; landing overshoot and settle |
| Easing | `EASE.linear/out/in/inOut/back` · `smooth` · `clamp` · `lerp` | exact curves (not Remotion's own `Easing.exp`, whose start is not exactly 0 and drops hidden layers) |
| Beats | `beats(bpm)` → `.beat/.at(n)/.bar(n)/.index(t)/.nearest` | land events on the beat instead of "roughly there" |
| Deterministic random | `rand(seed)` · `makeRand` · `wobble(seed,i,t)` · `stepped(t,perSecond)` | same seed, same result; replaces `Math.random()` |
| Shapes | `circle` · `polygon` · `line` · `toPath` · `drawOn` | point sequences |
| **Point-wise morph** | `morphPts(a,b,p)` · `morphPath` · `chain(t,segs)` · `converge(t,items,target)` | **the technical core**: same point count, interpolated per point = a real morph, not a cross-fade |
| Colour | `shadeHex(hex,k)` | light and dark of the same hue, no new colours |
| Character | `Body` · `Pose` · `rig` · `grip` · `nearSide` · `poseMix` · `walk` | skeletal solve; `grip()` puts the hand on the prop, `rig()` keeps the feet on the ground |
| Texture | `roughFor(sizePx,strength)` | scale ink-edge roughness by size (small type stays sharp, large type is not stiff) |
| Components | `Stage` · `Reveal` · `Letters` · `Counter` | full-frame container, hard-edge wipe, per-glyph entrance (spaces preserved), digit roll |

### Why it must not be modified

Because if it changes, **the gates' readings stop being comparable**.

- `film.mjs` measures the motion curve. If every film eases differently, the "4× median frame delta" threshold loses meaning — last film's spike and this film's spike are not the same quantity.
- `EASE.*` are closed-form (given `t`, compute directly; no integration, no reading the previous frame). Remotion's frame-seek rendering must produce the same picture at any timestamp; an integrative implementation would drift under seek.
- `rand/wobble` are seeded. Swap in `Math.random()` and the same code renders differently twice, so every still-comparison in the gates fails.

**To change behaviour, change the values in `src/spec.ts` and the implementation in `src/scenes/`.** Those are where design decisions live.

### Where it sits on the two routes

| | Remotion route | Pure-Node route |
|---|---|---|
| File | `src/lib/motion.tsx` | `src/lib/motion-core.mjs` |
| Depends on | React + Remotion API (`useCurrentFrame`/`useVideoConfig`) | nothing, pure functions |
| Components | yes (`Stage`/`Reveal`/`Letters`/`Counter` return JSX) | no (computation only) |
| Maths | identical | identical |

The maths layer is the same on both routes (`morphPts`/`chain`/`converge`/`rig`/`EASE` correspond line for line). Only "how the result is drawn" differs: React renders SVG on one, a hand-written rasteriser fills pixels on the other.

### One sentence

**The four layers are the process that makes decisions; `motion.tsx` is the foundation that executes them.** The foundation takes no part in deciding, but change it and every audit reading above it becomes incomparable — which is why it is on the do-not-modify list.

## Boundaries

**Layer 1 owns "did anything get dropped", not "is it good."** Three tables answer three different questions; merging them guarantees a miss: S (what did the user ask for), X (what turns into what), E (was every drawn thing designed). It does not own aesthetics.

**Layer 2 owns "does it look like the thing", not "did we build the thing the user asked for."** Craft can produce a beautiful film that is entirely off-brief.

**Layer 3 owns "can it be proven", not "is it right".** This is the project's only original contribution. Comparable skills validate by **asking the model to grade itself**, which carries confirmation bias.

The gates check only what code can decide: duration/fps/size match the spec; every ledger row has an id in the source; no forbidden patterns (unledgered gradients, glow, emoji, TODOs); no **undeclared** motion spikes; no long dead zones; a loop seam that matches; a non-silent audio track when the spec declares sound.

Note the distinction in the last items: the gate does not judge "should there be a spike here". It judges **"did you declare it"**. Spikes and stillness are *declarative*: the ledger carries `### 计划内运动峰值` (planned motion peaks) and `### 计划内静止` (planned stillness) tables, and the code only verifies that every actual peak falls inside a declared window. Real shape morphs are never false-flagged, and an undeclared jolt is always caught. **Only the author knows whether a given movement is right; the code's job is to catch movement you did not declare.**

**Layer 4 owns "can this ship", not "what does the picture look like".** A rendered film is not a deliverable. Doing subtitles, multi-track, voice alignment and mixing in code is possible but **not worth it**: changing one word means re-rendering the whole film, while a timeline edit is a drag.

## Where Concat sits

**Concat is one implementation of layer 4 (delivery). It is not a fifth layer, and it does not replace layers 1–3.**

| | motion-ledger (layers 1–3) | Concat (layer 4) |
|---|---|---|
| What | Generator | Editor |
| Owns | What this frame looks like | What is on the timeline, when it appears |
| How to change | Edit code, re-render | Drag timeline, export |
| Strong at | Exact values, real morphs, reproducibility, gateable | Subtitles, multi-track, transitions, mixing, fast iteration |
| Weak at | Changing one time point requires a full re-render | Cannot draw "five blocks morph point-by-point into a ring" |

**Why it must not replace layers 1–3**: that is drawing animation in an editor — hand-placing every frame, with no ledger, no gates, no reproducibility. It returns to the exact problem this pipeline exists to solve.

**Why it is worth connecting**: forcing layer-4 work into code pollutes layers 2 and 3 — you edit `scenes/` to add one subtitle, re-run the gates, and discover the motion curve changed. That is layer confusion, not diligence.

The bridge is `scripts/concat-bridge.mjs`. Without Concat, layer 4 does not disappear; it just becomes ffmpeg (`-vf subtitles=`, `-i voice.wav -shortest`, `-filter_complex xfade`). The layer stays, the implementation changes.

## Why four layers, not three or five

- **Drop layer 1** → the gates have nothing to reconcile against; they can only check generic rules (glow, TODOs), never "you asked for 15 seconds and got 10".
- **Drop layer 2** → every ledger row is satisfied and the film still looks like a template. Ledgers prevent omissions, not ugliness.
- **Drop layer 3** → back to "the model says it is done", which is the exact failure this project exists to fix.
- **Add layer 5** (publishing: upload, captions, platform copy) → that is operations, not production. It would blur the boundary and each platform's rules would outgrow the craft itself.

Four layers cover: think it through → build it → prove it is right → ship it.
