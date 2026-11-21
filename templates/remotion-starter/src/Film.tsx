// Film.tsx — 全片装配。持久元素在这里画一次，贯穿全片。
//
// 场景**不用 <Sequence>**：每场拿绝对 t，在窗口外 return null。
// 这样 seek 到任意时刻都能直接算出画面。

import React from 'react';
import { AbsoluteFill, Audio, staticFile } from 'remotion';
import { FILM, PALETTE } from './spec';
import { Stage, useTime } from './lib/motion';
import { Scene01 } from './scenes/Scene01';
import { Scene02 } from './scenes/Scene02';

// Remotion 渲染时会固定把音频压掉约 3.2dB（实测 score.wav peak 0.890 → 成片 0.614），
// 不补回来配乐就偏小。10^(3.2/20) ≈ 1.45。
//
// 想让成片再小声几 dB，改这里：volume = 1.45 / 10^(降幅dB / 20)。
// 纪律：整片电平只在这一处改，**不要动 score.mjs 的归一化系数**——
// 那改的是配乐内部各层之间的相对平衡。
//
// 字幕不放这里：字幕是唯一改一次就要重渲全片的元素，默认交给剪辑器
// （concat-bridge.mjs --subs-from-spec）。真需要烧进画面时，
// 参照 references/08-delivery.md 的「字幕：默认不在画面里」加一个 <Subtitles />。
const MASTER_VOL = 1.45; // S19

export const Film: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE[0] }}>
      {/* E04 背景：贯穿全片画一次，不是每场重画 */}
      <Stage bg={PALETTE[0]}>
        <Backdrop />
      </Stage>

      <Scene01 />
      <Scene02 />

      {/* S05 有配乐。score.mjs 产出 public/score.wav */}
      {FILM.sound ? <Audio src={staticFile('score.wav')} volume={MASTER_VOL} /> : null}
    </AbsoluteFill>
  );
};

/** E04 背景：上亮下暗（光从上方来，有动机）+ 极缓呼吸。
 *
 *  呼吸不是装饰：整片有 4 秒的结尾 hold，如果背景也完全静止，
 *  运动曲线会有一段被判成死区。呼吸让"停住"仍是活的。
 */
const Backdrop: React.FC = () => {
  const { t } = useTime();
  // 一次呼吸 7 秒，幅度极小（0.4%）——看得见生命，看不见晃动
  const b = Math.sin((t / 7) * Math.PI * 2) * 0.5 + 0.5;
  const y = 28 + b * 4;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 90% at 50% ${y}%, ${PALETTE[0]} 0%, #16261F 62%, #0E1A15 100%)`,
      }}
    />
  );
};
