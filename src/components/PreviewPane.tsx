import { useEffect, useRef, useState } from 'react';
import type { Character, Cut, GameTemplate } from '../types';
import { CANVAS_W, CANVAS_H, drawCut, type ImageStore } from '../renderer/draw';
import type { Asset } from '../hooks/useAssets';

interface Props {
  cuts: Cut[];
  characters: Character[];
  template: GameTemplate;
  images: ImageStore;
  assets: Map<string, Asset>;
}

const DEFAULT_CUT_SECONDS = 2.5;

export function PreviewPane({ cuts, characters, template, images, assets }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const currentBgmName = useRef<string | null>(null);

  const clamped = Math.min(index, Math.max(0, cuts.length - 1));
  const cut: Cut | undefined = cuts[clamped];

  // 描画
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    if (cut) {
      drawCut(ctx, cut, images, characters, template);
    } else {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = '#101220';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('脚本を書くとここにプレビューが表示されます', CANVAS_W / 2, CANVAS_H / 2);
    }
  }, [cut, images, characters, template]);

  // BGM / SE
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
    const se = cut.se ? assets.get(cut.se) : undefined;
    if (se?.kind === 'audio') {
      const audio = new Audio(se.url);
      audio.play().catch(() => {});
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
