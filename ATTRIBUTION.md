# 来源与许可

本项目不是任何单一上游项目的复刻。它把四个公开项目的**规则与方法**综合成一套可执行的纪律，并补上了它们都没有的**代码门禁层**。

本仓库**不包含**上述项目的源代码、样片、图片或音频。`verify/` 下的三个脚本为本项目原创。

---

## 1. 纪律层

**8533502-dev/deepseek-opus-motion-skill** — MIT
<https://github.com/8533502-dev/deepseek-opus-motion-skill>

来源内容：
- 三张台账（`S##` 需求 / `X##` 变形 / `E##` 元素）的划分与字段
- 9 类元素 playbook 的分类与"常见失败"清单
- 五评委（SPEC / CONTINUITY / RHYTHM & SOUND / DESIGN / CRAFT）的维度与"低于 8 分逐条修"的规则
- 禁用清单（未被要求的渐变、glow、通用淡入、粒子爆发、镜头抖动、RGB 分离、stock 图标等）
- "helper 与 example 只是机制不是风格"的优先级表述

本项目改写：把"模型自评五评委"降级为**参考维度**，把其中可判定的部分搬到 `verify/` 的代码门禁里。

---

## 2. 工艺层

**nexu-io/open-design** `skills/motion-design` — Apache License 2.0
<https://github.com/nexu-io/open-design>

来源内容：
- 时值表（小强调 120–220ms / 主元素入场 350–650ms / 形变 600–1200ms / 大揭示 900–1800ms）
- 视觉语法四类（product/brand、kinetic typography、explainer/data、art/procedural）
- 注意力编排三层（主行动 / 次行动 / 环境运动）
- "弱静帧救不回来"、"Premium/cinematic/modern 单独出现不算美术方向"、单一材质世界逻辑
- 声音政策（voice/music/effects 分开决定、"不要旁白"只禁语音、显式静音优先）
- 有界视频检查（首渲后只做一次复核，最多一次定向修复，不许无休止打磨）
- 缺陷→决策对照表

---

## 3. 验收层

**alchaincyf/huashu-art-motion** — MIT
<https://github.com/alchaincyf/huashu-art-motion>

来源内容：
- "反 PPT 门禁"的思路：整片几乎没有镜头内快动作就红灯，不出片
- 独立复审机制：派一个没参与制作的 agent 只看成片挑问题

本项目改写：反 PPT 门禁从"看整片"细化为**每 0.5 秒运动曲线 + 中段死区检测**，见 `verify/film.mjs`。

---

## 4. 复审纪律

**Vincentwei1021/video-shotcraft** — Apache License 2.0
<https://github.com/Vincentwei1021/video-shotcraft>

来源内容：
- "制作者对自己的产出有确认偏差，首检永远不能交给用户"——独立 subagent 终检的纪律

---

## 5. 参考但未采用

| 项目 | 许可 | 为什么不采用 |
|---|---|---|
| `OpenMontageInc/OpenMontage` | **AGPL-3.0** | 传染性许可，商用/闭源集成受限 |
| `heygen-com/hyperframes` | Apache-2.0 | 是渲染后端，与本项目的纪律层不冲突，可配合使用 |
| `kelano86/what-if-animation` | MIT | 单题材垂直，规则不可直接迁移 |
| `Kianzzz/xilo-opus-video` | MIT | "先给三个方案+预览"的交互，与本项目"不卡住用户"的原则冲突 |

---

## 商标与产品

- Remotion 是 Remotion AG 的产品，许可见 <https://www.remotion.dev/license>。个人免费；公司 ≤3 人免费；更大公司需购买公司许可。
- 本项目不隶属于上述任何项目或公司。
