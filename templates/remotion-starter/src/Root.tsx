// Root.tsx — 注册 Composition。**不要改这个文件**（要改时长/画幅请改 src/spec.ts 的 FILM）。
import { Composition } from 'remotion';
import { Film } from './Film';
import { FILM } from './spec';

export const Root: React.FC = () => {
  return (
    <Composition
      id="Film"
      component={Film}
      durationInFrames={Math.round(FILM.duration * FILM.fps)}
      fps={FILM.fps}
      width={FILM.width}
      height={FILM.height}
    />
  );
};
