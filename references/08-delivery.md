# 08 · 交付与下游剪辑（Concat 桥）

## 这一层解决什么

motion-ledger 能出成片，但成片不是交付物。真实交付还要：字幕、多轨、转场、配音、混音、按平台改比例。这些事在代码里做不是不能做，是**不值得**——它们本来就有专门的工具，而且改起来要重渲整片。

所以这一层的分工是明确的：

| | motion-ledger | Concat |
|---|---|---|
| 是什么 | 生成器 | 剪辑器 |
| 管什么 | 这一帧长什么样 | 时间线上有什么、什么时候出现 |
| 怎么改 | 改代码，重渲 | 拖时间线，导出 |
| 强项 | 精确数值、真变形、可复现、可门禁 | 字幕、多轨、转场、混音、快速试错 |
| 弱项 | 改一个时间点要重渲全片 | 画不出「五个方块变成环」这种逐点插值 |

**不要用 Concat 替代 Remotion。** 那等于用剪辑软件画动画——每一帧手工摆位置，回到没有台账、没有门禁的老路。也不要指望 Remotion 做字幕排版和配音对齐——那是剪辑器的活。

正确的接法是：**代码出画面，剪辑器管时间线与文字**。中间用 `scripts/concat-bridge.mjs` 衔接。

---

## 桥接脚本

```bash
# 最简：出片 → 导入 → 上时间线 → 导出
node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4

# 加一条字幕
node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 \
  --caption "静水流深" --caption-start 0.6 --caption-dur 3.0

# 机器可读结果（给 agent 用）
node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 --json
```

参数全表：

| 参数 | 说明 |
|---|---|
| `--film <path>` | motion-ledger 渲染出的成片（必需） |
| `--out <path>` | 最终交付路径（必需） |
| `--caption <文本>` | 加一条字幕 |
| `--caption-start <秒>` | 字幕起点，默认 0.5 |
| `--caption-dur <秒>` | 字幕时长，默认 3 |
| `--caption-size <比例>` | 字号占画幅高度的比例，默认 0.09 |
| `--font <字体名>` | 默认 Noto Sans SC |
| `--color <#rrggbb>` | 默认 #F4F1EA |
| `--work <目录>` | 工程目录；默认在用户主目录下 |
| `--concat <path>` | 指定 concat.exe；默认自动找 |
| `--timeout <秒>` | 导出等待上限，默认 300 |
| `--json` | 输出机器可读结果 |
| `--keep` | 保留中间工程目录（默认清掉） |

跑通的实测输出：

```
Concat 0.2.12 · D:\Program Files\Concat\concat.exe
工程 C:\Users\boosn\.motion-ledger-concat\film-mwp0ug00
导入 m1 · 15.019s · 1920×1080
字幕「静水流深」· 0.6–3.6s
交付 C:\Users\boosn\AppData\Local\Temp\bridge-test.mp4 · 847551 bytes
```

---

## Concat 的接入事实（都是实测，不是文档抄的）

### 通道是 MCP，不是裸 JSON-RPC

`concat.exe --mcp headless` 起来后，往 stdin 写裸方法名会被拒：

```json
{"method":"version","id":1}
→ {"error":{"code":-32601,"message":"Method not found: version"},"id":1}
```

必须走标准 MCP 握手：`initialize`（`protocolVersion: "2024-11-05"`）→ `notifications/initialized` → `tools/list` → `tools/call`。`tools/list` 返回 **46 个工具**，名字是下划线风格（`project_open`、`clip_add`、`title_add`、`export_start`），和 `--schema` 里那些点号方法名（`project.open`）**不是同一套**——schema 是它内部的请求格式，MCP 才是对外接口。

### headless 只许写用户主目录

stderr 会打印：

```
concat mcp: serving through {"mode":"headless","writesUnder":["\\\\?\\C:\\Users\\boosn"]}
```

所以工程目录落在 `C:\Users\<user>` 下，成片再拷到 `--out`。脚本默认用 `~/.motion-ledger-concat/`，跑完自动清掉。要放别处必须传 `--work`，但 headless 仍然会拒写——这时候要么改用 `--mcp window`（需要桌面会话），要么就让它留在默认位置。

### 项目不会自己保持打开

每次 `tools/call` 之前必须 `project_open`，否则回：

```
C:\Users\boosn\concat-motion-probe\probe is not open - open it first (code: notOpen)
```

进程一退，项目就不算开着。桥接脚本在一个进程里跑完整条链路，就是为了避开这个。

### 三个参数坑（每个都让第一版失败过）

1. **`title_add` 的文案在 `style.content`，不在顶层 `text`。** 写错不报错，只是给你一个占位符 `"Your text"`。`style` 支持 `content`/`fontFamily`/`fontSize`（画幅高度比例，默认 0.09）/`fontWeight`(100–900)/`color`/`align`/`background`/`strokeWidth`。
2. **`export_start` 返回 `{job: "j1"}`，不是 `jobId`。** `export_wait` 只认 `job`，`timeoutSeconds` 默认 60、上限 600。
3. **`clip_add` 的 `start` 是绝对秒，且不传 `ripple` 时新片段会叠上去而不是挤开。** 想接在原片开头就 `start: 0`；不传的话第二次导入会接到 15.019s 之后，时间线变成 30 秒。

### 导出状态

`export_status` / `export_wait` 回 `state`（`running`/`done`/`cancelled`/`failed`）、`stage`（`cutout`/`stabilize`/`rendering`/`mixing audio`/`muxing`）、已完成帧数/总帧数、`fraction`。一次 `export_wait` 常常就等到 `done`（15s 的 1080p 片子几秒就完）。

---

## 什么时候该用这一层

| 需求 | 该在哪做 |
|---|---|
| 画面内容、元素、变形、配色 | **motion-ledger**（代码 + 台账 + 门禁） |
| 字幕文案与位置 | Concat（`title_add` / `captions_add`），或 motion-ledger 里用 `<Letters>` 画死 |
| 多段片子拼接、调顺序 | Concat |
| 配音与口型/字幕对齐 | Concat（带 whisper，可自动转写） |
| 转场、滤镜、调色 | Concat |
| 改一个时间点的内容 | Concat（motion-ledger 要重渲全片） |
| 「五个方块逐点变成环」这种真变形 | **motion-ledger**（Concat 画不出来） |
| 需要门禁证明「没有用叠加假装变形」 | **motion-ledger** |

**判断规则**：改的是「画面里有什么形状、怎么动」→ motion-ledger；改的是「什么时候出现、上面写什么字、跟别的片子怎么接」→ Concat。

---

## 不给 Concat 时的替代方案

没有 Concat 也能交付，只是少一层便利：

- **字幕**：在 motion-ledger 里用 `<Letters>` / `<Reveal>` 画进画面，或者 `ffmpeg -vf subtitles=` 烧硬字幕。缺点是要重渲。
- **配音**：`ffmpeg -i film.mp4 -i voice.wav -c:v copy -c:a aac -shortest`。对齐靠 `cues.json` 里的时间表。
- **多段拼接**：`ffmpeg -f concat -safe 0 -i list.txt -c copy`。
- **转场**：`ffmpeg -filter_complex xfade`。

这些都能做，但没有「拖一下就好」的编辑手感，而且每改一次都要重新走一遍命令。Concat 的价值就在这里。

---

## 一个诚实的限制

桥接脚本目前只覆盖「导入一条片子 + 加字幕 + 导出」。Concat 的 46 个工具里还有 `clips_split`（切分）、`clip_speed`（变速）、`keyframe_set`（关键帧动画）、`effect_layer_add`（特效层）、`captions_add`（批量字幕）、`clip_stabilize`（防抖）、`clip_masks`（遮罩）——这些都可用，但脚本没有逐个封装。

原因是：**封装得越多，越容易变成一个半吊子的剪辑器 API**。需要的时候直接调 MCP 工具比调一个中间层更清楚。脚本只做「最常走的那条路」，剩下的留给 agent 直接调——它的 46 个工具都有 `description`，`tools/list` 就能读到。
