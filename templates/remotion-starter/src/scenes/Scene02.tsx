// Scene02.tsx — 场 2：环转起来 → 环变成横条字标 → 落定 hold
//
// X02 变形台账：
//   环（五段弧合起来的整圆）→ 横条超椭圆
//   机制：环的点集整体逐点 morph 到 barPts 的点集（点数相同 96）
//   守恒：环的周长 ≈ 横条的周长（视觉上"同一根线被拉直"）

import React from 'react';
import { PALETTE, TIMER, MARK, T } from '../spec';
import { useTime, prog, EASE, morphPts, toPath, settle, clamp, beats } from '../lib/motion';
import { RING, BAR } from '../geometry';

export const Scene02: React.FC = () => {
  const { t } = useTime();

  // 场窗口：从 timerIn 开始，到片尾
  if (t < T.timerIn - 0.3) return null;

  // 环入场：从 0 长出来
  const intro = prog(t, T.timerIn - 0.3, 0.6, EASE.out);

  // 环整体缓慢旋转：6 秒一圈，匀速——机械运动用 linear，不用缓动
  const rot = (t / 6) * 360;

  // X02：环 → 横条
  const p = prog(t, T.growStart, T.growDur, EASE.inOut);

  // 落定：settle 的过冲很小，不是弹簧玩具
  const land = settle(t, 30, T.settle, { lead: 0.05, dur: 0.5, bounce: 0.014 });

  // 旋转**冻结在变形起点，再随变形归零**。
  //
  // 两个都不能省：
  //  - 不冻结 → 变形第一帧角度突变，看起来像剪辑点
  //  - 不归零 → 横条被转成竖条（450° = 90°），字标方向就错了
  // 归零的物理读法：转动的环被拉直，转动随之停下。
  const rotFrozen = (T.growStart / 6) * 360;
  const spin = p > 0 ? rotFrozen * (1 - p) : rot;

  // 环的点 → 横条的点（两者都是 96 点，且都以 (960,540) 为锚点）
  const pts = morphPts(RING, BAR, p);

  // 描边 → 填充的交接：形状一直是同一条线，只是渲染方式变了
  const asStroke = clamp(1 - (p - 0.6) / 0.4);
  const asFill = clamp((p - 0.55) / 0.35);

  // 落定之后不是完全静止：极缓的呼吸（±0.6%），让画面有生命但不晃
  const breath = 1 + Math.sin(t * 1.05) * 0.006;

  // 刻度：落在拍上（S17 BPM 72 → 0.833s/拍）
  const b = beats(72);
  const ticks = Array.from({ length: TIMER.ticks }, (_, i) => i).filter(
    (i) => t >= b.at(i * 2) && p < 0.5
  );

  // 字标里三条凹口：落定后 0.2s 内依次出现
  const notches = [0, 1, 2].map((i) => prog(t, T.settle + i * 0.09, 0.3, EASE.out));

  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0 }}>
      <g transform={`rotate(${spin} ${TIMER.cx} ${TIMER.cy})`}>
        {/* 描边阶段：环 */}
        {asStroke > 0.01 ? (
          <path
            d={toPath(pts.slice(0, Math.max(2, Math.round(pts.length * intro))), false)}
            fill="none"
            stroke={PALETTE[1]}
            strokeWidth={TIMER.stroke}
            strokeLinecap="round"
            opacity={intro * asStroke}
          />
        ) : null}

        {/* 填充阶段：横条字标 */}
        {asFill > 0.01 ? (
          <g transform={`translate(${MARK.cx} ${MARK.cy}) scale(${breath}) translate(${-MARK.cx} ${-MARK.cy})`}>
            <path d={toPath(pts, true)} fill={PALETTE[1]} stroke="none" opacity={asFill * intro} />
          </g>
        ) : null}
      </g>

      {/* E02 刻度：五条，落在拍上 */}
      {ticks.map((i) => {
        const a = (i / TIMER.ticks) * Math.PI * 2 - Math.PI / 2;
        const x1 = TIMER.cx + Math.cos(a) * (TIMER.r + 18);
        const y1 = TIMER.cy + Math.sin(a) * (TIMER.r + 18);
        const x2 = TIMER.cx + Math.cos(a) * (TIMER.r + 34);
        const y2 = TIMER.cy + Math.sin(a) * (TIMER.r + 34);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={PALETTE[2]}
            strokeWidth={TIMER.stroke}
            strokeLinecap="round"
            opacity={intro * (1 - p)}
          />
        );
      })}

      {/* E03 三条凹口：让它是"字标"而不是"药丸" */}
      {notches.map((np, i) => {
        const x = MARK.cx - MARK.w / 2 + MARK.w * (0.26 + i * 0.24);
        const h = MARK.h * 0.46 * np;
        return (
          <rect
            key={i}
            x={x - 5}
            y={MARK.cy - h / 2}
            width={10}
            height={h}
            rx={5}
            fill={PALETTE[2]}
            opacity={np}
          />
        );
      })}
    </svg>
  );
};
