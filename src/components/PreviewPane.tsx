import { useEffect, useRef, useState } from 'react';
import type { Character, Cut, GameTemplate } from '../types';
import {
  CANVAS_W,
  CANVAS_H,
  DICE_ROLL_SECONDS,
  drawCut,
  type ImageStore,
} from '../renderer/draw';
import { DEFAULT_CUT_SECONDS } from '../script/player';
import type { Asset } from '../hooks/useAssets';

interface Props {
  cuts: Cut[];
  characters: Character[];
  template: GameTemplate;
  images: ImageStore;
  assets: Map<string, Asset>;
  /** キャラにダイスセット未設定のときに使うフォルダ */
  defaultDiceFolder?: string;
  /** false でダイス連番アニメを行わない */
  diceAnimation: boolean;
}

export function PreviewPane({
  cuts,
  characters,
  template,
  images,
  assets,
  defaultDiceFolder,
  diceAnimation,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const currentBgmName = useRef<string | null>(null);

  const clamped = Math.min(index, Math.max(0, cuts.length - 1));
  const cut: Cut | undefined = cuts[clamped];

  // 脚本編集でカット数が減ったとき、index が範囲外のまま残らないようにする
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, cuts.length - 1)));
  }, [cuts.length]);

  // 描画。ダイスカットはカット表示開始からの経過時間で連番アニメを回す
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    if (!cut) {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = '#101220';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('脚本を書くとここにプレビューが表示されます', CANVAS_W / 2, CANVAS_H / 2);
      return;
    }

    const options = { defaultDiceFolder, diceAnimation };
    if (!cut.dice || !diceAnimation) {
      drawCut(ctx, cut, images, characters, template, options);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      drawCut(ctx, cut, images, characters, template, { ...options, timeInCut: t });
      if (t < DICE_ROLL_SECONDS + 0.1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [cut, images, characters, template, defaultDiceFolder, diceAnimation]);

  // BGM / SE
  // cut オブジェクトは脚本の再パースで毎回作り直されるため、参照ではなく
  // カット位置（index）の変化でガードしないと編集のたびにSEが再発火する
  const lastSeCutIndex = useRef<number>(-1);
  useEffect(() => {
    if (!cut) return;
    if (cut.bgm !== currentBgmName.current) {
      bgmRef.current?.pause();
      bgmRef.current = null;
      currentBgmName.current = cut.bgm;
      const asset = cut.bgm ? assets.get(cut.bgm) : undefined;
      if (asset?.kind === 'audio') {
        const audio = new Audio(asset.url);
        audio.loop = true;
        audio.volume = 0.6;
        audio.play().catch(() => {});
        bgmRef.current = audio;
      }
    }
    if (cut.index !== lastSeCutIndex.current) {
      lastSeCutIndex.current = cut.index;
      const se = cut.se ? assets.get(cut.se) : undefined;
      if (se?.kind === 'audio') {
        const audio = new Audio(se.url);
        audio.play().catch(() => {});
      }
    }
  }, [cut, assets]);

  // アンマウント時にBGM停止
  useEffect(() => () => bgmRef.current?.pause(), []);

  // 自動再生
  useEffect(() => {
    if (!playing || !cut) return;
    if (clamped >= cuts.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(
      () => setIndex((i) => i + 1),
      (cut.waitSeconds ?? DEFAULT_CUT_SECONDS) * 1000,
    );
    return () => clearTimeout(t);
  }, [playing, clamped, cut, cuts.length]);

  return (
    <div className="preview-pane">
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="preview-canvas" />
      <div className="preview-controls">
        <button onClick={() => setIndex(0)} disabled={cuts.length === 0} title="最初へ">
          ⏮
        </button>
        <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={clamped <= 0} title="前のカット">
          ◀
        </button>
        <button
          className="play-button"
          onClick={() => setPlaying((p) => !p)}
          disabled={cuts.length === 0}
          title={playing ? '一時停止' : '再生'}
        >
          {playing ? '⏸ 停止' : '▶ 再生'}
        </button>
        <button
          onClick={() => setIndex((i) => Math.min(cuts.length - 1, i + 1))}
          disabled={clamped >= cuts.length - 1}
          title="次のカット"
        >
          ▶
        </button>
        <span className="cut-counter">
          {cuts.length === 0 ? '- / -' : `${clamped + 1} / ${cuts.length}`}
        </span>
      </div>
    </div>
  );
}
