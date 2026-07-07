import { useEffect, useRef, useState } from 'react';
import type { Character, Cut, GameTemplate } from '../types';
import {
  CANVAS_W,
  CANVAS_H,
  DICE_ROLL_SECONDS,
  drawCut,
  setCanvasFont,
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
  /** 動画キャンバスのフォント（未指定は同梱UDフォント） */
  fontFamily?: string;
}

/** Audio要素の音量を段階的に変化させる（プレビュー用の簡易フェード）。戻り値は中断関数 */
function rampVolume(
  audio: HTMLAudioElement,
  from: number,
  to: number,
  seconds: number,
  onDone?: () => void,
): () => void {
  const stepMs = 50;
  const steps = Math.max(1, Math.round((seconds * 1000) / stepMs));
  let i = 0;
  const timer = setInterval(() => {
    i++;
    audio.volume = Math.min(1, Math.max(0, from + ((to - from) * i) / steps));
    if (i >= steps) {
      clearInterval(timer);
      onDone?.();
    }
  }, stepMs);
  return () => clearInterval(timer);
}

export function PreviewPane({
  cuts,
  characters,
  template,
  images,
  assets,
  defaultDiceFolder,
  diceAnimation,
  fontFamily,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  // 同梱フォントの読み込み完了後に再描画する（初回描画がフォールバック字形になるのを防ぐ）
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    document.fonts.ready.then(() => setFontsReady(true));
  }, []);
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
    setCanvasFont(fontFamily);
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
    // 時間演出（ダイス・暗転・明転）があるカットは経過時間で描き直す
    const animateUntil = Math.max(
      cut.dice && diceAnimation ? DICE_ROLL_SECONDS + 0.1 : 0,
      cut.fadeInSeconds ?? 0,
      cut.fadeOutSeconds ?? 0,
    );
    if (animateUntil === 0) {
      drawCut(ctx, cut, images, characters, template, options);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      drawCut(ctx, cut, images, characters, template, { ...options, timeInCut: t });
      if (t < animateUntil) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [cut, images, characters, template, defaultDiceFolder, diceAnimation, fontFamily, fontsReady]);

  // BGM / SE
  // cut オブジェクトは脚本の再パースで毎回作り直されるため、参照ではなく
  // カット位置（index）の変化でガードしないと編集のたびにSEが再発火する
  const lastSeCutIndex = useRef<number>(-1);
  const fadeCancelRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!cut) return;
    if ((cut.bgm?.asset ?? null) !== currentBgmName.current) {
      fadeCancelRef.current?.();
      const old = bgmRef.current;
      bgmRef.current = null;
      currentBgmName.current = cut.bgm?.asset ?? null;

      // 直前トラックはフェードアウト指定があれば徐々に消す
      if (old) {
        const fadeOut = cut.bgmFadeOutSeconds ?? 0;
        if (fadeOut > 0) rampVolume(old, old.volume, 0, fadeOut, () => old.pause());
        else old.pause();
      }

      const asset = cut.bgm ? assets.get(cut.bgm.asset) : undefined;
      if (cut.bgm && asset?.kind === 'audio') {
        const audio = new Audio(asset.url);
        audio.loop = true;
        if (cut.bgm.fadeInSeconds > 0) {
          audio.volume = 0;
          fadeCancelRef.current = rampVolume(audio, 0, cut.bgm.volume, cut.bgm.fadeInSeconds);
        } else {
          audio.volume = cut.bgm.volume;
        }
        audio.play().catch(() => {});
        bgmRef.current = audio;
      }
    } else if (bgmRef.current && cut.bgm) {
      // 同一トラックの音量変更
      bgmRef.current.volume = cut.bgm.volume;
    }
    if (cut.index !== lastSeCutIndex.current) {
      lastSeCutIndex.current = cut.index;
      const se = cut.se ? assets.get(cut.se.asset) : undefined;
      if (cut.se && se?.kind === 'audio') {
        const audio = new Audio(se.url);
        audio.volume = cut.se.volume;
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
