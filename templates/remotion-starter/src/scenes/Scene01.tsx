// Scene01.tsx — 场 1：五个方块散落 → 各自变成环的 1/5 → 拼成完整环
//
// X01 变形台账：
//   五个超椭圆方块 → 环的五段弧（逐点 morph，源在目标成形时消失）
//   机制：每个方块把自己的 96 个点走到对应弧段的 96 个点上
//   守恒：五个物体的数量不变，一个不消失；合并后总周长守恒

import React from 'react';
import { PALETTE, BLOCKS, TIMER, T } from '../spec';
import { useTime, prog, EASE, morphPts, toPath, clamp } from '../lib/motion';
import { BLOCK_SHAPE, ARC, scatterPositions } from '../geometry';

export const Scene01: React.FC = () => {
  const { t } = useTime();  // 绝对秒

  // 场窗口：0 → gatherStart + gatherDur + 0.2 收尾
  const end = T.gatherStart + T.gatherDur + 0.2;
  if (t > end) return null;   // 窗口外返回 null，不用 <Sequence>

  const starts = scatterPositions();  // E01 E02 E03 E04 E05

  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0 }}>
      {starts.map(([sx, sy], i) => {
        // 每个方块错开出发（0.06s 一个），不是齐步走
        const lag = i * 0.06;
        const p = prog(t, T.gatherStart + lag, T.gatherDur - lag, EASE.inOut);  // X01

        // 源：方块在散落点；目标：环的第 i 段弧
        const src = BLOCK_SHAPE.map(([x, y]) => [x + sx, y + sy] as [number, number]);
        const dst = ARC(i);
        const pts = morphPts(src, dst, p);

        // 入场：头 0.5s 从 0 长出来（drawOn 语义）
        const intro = prog(t, 0.15 + i * 0.07, 0.5, EASE.out);
        const shown = p < 1 ? pts.slice(0, Math.max(2, Math.round(pts.length * intro))) : pts;

        // 身份延续：同一个调色板索引贯穿全片，换材质也不换色
        const color = PALETTE[1];

        // 成形后是**开放**的弧，不是闭合的多边形。
        // 闭合的弧会拉出一条弦，五条弦拼起来就是个五边形——那是假变形。
        const closed = p < 0.98;

        return (
          <path
            key={i}
            d={toPath(shown, closed)}
            fill={closed ? color : 'none'}
            stroke={color}
            strokeWidth={closed ? 0 : TIMER.stroke}
            strokeLinecap="round"
            opacity={clamp(intro, 0, 1)}
          />
        );
      })}
    </svg>
  );
};
