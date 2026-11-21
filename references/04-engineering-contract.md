# 04 · 工程契约

三个渲染栈：**Remotion**（React + SVG → MP4）、**HTML + GSAP**（浏览器时间线 → 截帧 → MP4）、**node-starter**（`@napi-rs/canvas` 或纯 Node 光栅 → rawvideo pipe → ffmpeg）。**选哪条**见 `10-route-selection.md`。

无论用哪个，**确定性规则完全相同**。违反任何一条，`verify/film.mjs` 会抓出来。

---

## 通用确定性规则（三个栈都必须遵守）

| 禁止 | 为什么 | 用什么代替 |
|---|---|---|
| `Date.now()` / `new Date()` 参与画面 | 每帧不同 → 无法复现 | 时间函数 `f(t)` |
| `Math.random()` | 每次渲染不同 | `rand(seed)` 种子随机 |
| 帧间 state（`useState` 驱动画面） | 抽帧渲染会跳帧 | 从 `t` 推导 |
| 独立 CSS 动画 / `@keyframes` | 与主时间线竞争，seek 时错位 | 主时间线驱动 |
| 定时器（`setTimeout` / `setInterval`） | 抽帧渲染不等待 | 从 `t` 推导 |
| 可见内容依赖 timeline 回调 | 导出 seek 时会抑制回调 | 在渲染函数里直接算 |
| 只能从 0 播放才对的模拟 | seek 到任意帧就错 | 闭式解（closed-form） |

### 为什么"闭式解"是关键

抽帧渲染会 `seek` 到任意时间点，**不按顺序播放**。

- ❌ 积分式模拟：`v += a * dt`（依赖前面的帧）
- ✅ 闭式解：`y = y0 + v0*t + 0.5*a*t*t`（任意 t 直接算）

弹簧、缓动、抛物线全部要写成闭式解。

### 伪随机

```js
// mulberry32
function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

种子**从索引派生**（`seed = index * 7919`），不要用一个全局计数器——那样元素顺序一变，全片纹理都变。

---

## 栈 A：Remotion

### 版本与禁改文件

- 测于 **Remotion 4.0.x + React 19**。
- **不许改**：`src/index.ts`、`src/Root.tsx`、`src/lib/motion.tsx`、`scripts/score.mjs`、`scripts/check.mjs`。
  这些是脚手架，改了门禁就不认。要改行为，改 `src/spec.ts` 与 `src/scenes/`。

### 时间

```tsx
const { t, fps, frame, D, width, height } = useTime(); // t 是绝对秒
```

- **只用 `useTime()`**，不要用 `useCurrentFrame()` 混着算。
- **场景不用 `<Sequence>`**：每场拿绝对 `t`，在窗口外 `return null`。
- **持久元素在 `Film.tsx` 里画一次**贯穿全片（背景、母题），不要每场重画。

```tsx
// Scene02.tsx
export const Scene02 = () => {
  const { t } = useTime();
  const p = prog(t, 3.2, 1.4, EASE.inOut); // X01
  if (t < 3.2 || t > 9.4) return null;      // 绝对时间窗
  return <g>{/* ... */}</g>;
};
```

### 缓动

- **只用 `EASE.*` 与 `settle()`**。
- **不要用 Remotion 自带的 `Easing.exp`**：它的起点不精确为 0，会漏出隐藏图层。

### 排版

- 文本用 **HTML**（`<div>` / `<span>`），字距用 `em`。
- 逐字动效用 `<Letters>`（保留空格）。
- pattern 填充 / 描边 / 裁剪用 **SVG `<text>`**。
- 中文竖排 `writingMode: 'vertical-rl'`。
- 字体用 `@remotion/google-fonts/<Family>` 的 `loadFont`，**只加载用到的字重**；CJK 族省略 `subsets`。

### 声音

`FILM.sound = true` 时播 `public/score.wav`。见 `06-sound.md`。

### 命令

```bash
npm run studio    # 预览
npm run render    # 出片
npm run check     # 抽帧自查
```

### 不留 TODO

写不下就在文件末尾写：

```
// CONTINUE FROM src/scenes/Scene03.tsx
```

---

## 栈 B：HTML + GSAP

### 合成骨架

```html
<div id="stage"
     data-composition-id="main"
     data-start="0"
     data-duration="15"
     data-width="1920"
     data-height="1080"
     data-poster-time="0"></div>
```

```js
window.__timelines = { main: tl };
tl.timeScale(1);          // 必须 1
tl.duration();            // 必须等于 data-duration
// 禁 repeat / startDelay
```

### 硬规则

- **`tl.duration(seconds)` 改的是播放速度，不是阅读停留。** 想加停留，就加 tween 的间隔，不要拉长总时长。
- 内容与绘制分离：duration / frame size / palette / type scale / easing / scene timings 收在**一个小配置对象**里。
- 场景在**任意时间戳**都要稳定（`seek` 到 7.31s 和从头播到 7.31s 画面必须一样）。
- 音频反应动效必须有**预计算包络**或**已知 beat map**。**绝不可暗示任意脉动是对音乐的分析。**

### 截图出片

```bash
ffmpeg -framerate 60 -i frames/%05d.png -c:v libx264 -pix_fmt yuv420p out/film.mp4
```

---

## 栈 C：node-starter（自写光栅 / Canvas 2D → rawvideo pipe）

零 npm 或仅 `@napi-rs/canvas`。模板见 `templates/node-starter/`，真实项目用法见本文件末尾的「栈 C 的三处陷阱」。

### 时间从哪来

没有渲染器给帧号，自己 pump：

```js
for (let i = from; i < to; i++) {
  const t = i / FILM.fps;          // 唯一的时间源
  drawScene(ctx, t);               // 一切都是 t 的闭式解
  await drain(ff.stdin.write(Buffer.from(cv.data())));
}
```

**禁止**用 `performance.now()` 或累计 `dt` 推进动画——那会让「渲第 900 帧」和「从头播到第 900 帧」结果不同。

### 输出

rawvideo 直接 pipe 给 ffmpeg，参数顺序硬要求**所有 `-i` 在输出选项之前**：

```js
const ff = spawn('ffmpeg', [
  '-v', 'error', '-y',
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps),
  '-i', 'pipe:0',
  ...(hasAudio ? ['-i', 'public/score.wav'] : []),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
  outFile,
]);
ff.stdin.on('error', (e) => { if (e.code !== 'EPIPE') throw e; });
```

`EPIPE` 必须吞掉：ffmpeg 提前退出（参数错、磁盘满）时，写端会收到 EPIPE，不吞就会盖掉 ffmpeg 真正的报错。

### 遮罩与差集（栈 C 的最大优势）

```js
// 文字遮罩擦除：字从下往上「长出来」，不是整体变淡
ctx.save();
ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
for (let i = 0; i < chars.length; i++) fillText(chars[i], x + adv * i, y + offs[i]);
ctx.restore();

// 环带：外圈顺时针 + 内圈逆时针 → nonzero winding 挖空
function bandFill(ctx, pts, w, color, alpha) {
  const cx = mean(pts.x), cy = mean(pts.y);
  const k = Math.max(0, 1 - w / perimeter(pts));
  poly(ctx, pts, { fill: color, alpha });
  poly(ctx, innerScaled(pts, cx, cy, k).reverse(), { fill: color, alpha });
}
```

### 栈 C 的三处陷阱

1. **`--spec` 传 `src/spec.mjs`**，不是 `src/spec.ts`；`FILM` 必须写成 `const FILM = {...};` 的单行字段形式（门禁用正则读，不是解释器）。
2. **`SUBS` 要手写**，形态 `[[起始秒, 结束秒, '文案']]`——`concat-bridge.mjs --subs-from-spec` 只认这个，缺了它静默通过且没有字幕。
3. **门禁从仓库根跑**。在模板目录里跑会 `MODULE_NOT_FOUND`。

---

## 工程结构（三栈通用）

```
项目/
  LEDGER.md          ← 三张台账
  src/
    spec.ts          ← 所有常量，每行带 // S## 或 // E##
    film.tsx         ← 元素 builder，每处带 // E##
    scenes/          ← 每场一个文件，节拍带 // S## X##
  out/
    film.mp4
    check/           ← 门禁产物：sheet / stills / audio.png
```

---

## 验收前的自查清单

- [ ] 所有常量都有台账 id（**不落成数字的条款写进文件头注释**——`collectSourceIds` 扫源码任意位置）
- [ ] 没有 starter 占位符（`TITLE` / `SUBTITLE` / `duration: 10`）
- [ ] 没有 `Date.now` / `Math.random` / `setTimeout` / `@keyframes`（确需 `Date.now` 打进度就加行尾 `// ledger-allow: 理由`）
- [ ] 场景在窗口外返回 null，不用 `<Sequence>`
- [ ] 缓动只用 `EASE.*` / `settle()`
- [ ] 没有 TODO
- [ ] 首帧不是闪色
- [ ] 循环时 `t=D` 帧等于第 0 帧
- [ ] 同类元素的退场手法统一（线在平滑退、字不能一帧消失）
- [ ] 收尾 hold 里没有「全幅亮度呼吸」（8 位量化会退化成整帧跳 1 级）

跑（**从仓库根**，node-starter 路线 `--spec` 传 `src/spec.mjs`）：

```bash
node verify/spec.mjs --ledger LEDGER.md --src src/
node verify/film.mjs --film out/film.mp4 --spec src/spec.ts
```
