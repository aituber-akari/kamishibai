import type { Cut } from '../types';
import { DEFAULT_CUT_SECONDS } from '../script/player';

/**
 * 音声タイムライン — カット列から導出する中間表現。
 * プレビュー再生と mp4 書き出しの両方がこれを唯一の真実として使う
 * （楓のレビュー指摘「音声経路の中間表現を書き出し前に定義せよ」への回答）。
 */

export interface CutTiming {
  /** カット開始秒（動画先頭からの累積） */
  start: number;
  /** 表示時間（秒） */
  duration: number;
}

/** BGMの連続再生区間 */
export interface BgmSegment {
  asset: string;
  start: number;
  end: number;
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

/** SEの発火イベント */
export interface SeEvent {
  asset: string;
  time: number;
  volume: number;
}

export interface AudioTimeline {
  bgm: BgmSegment[];
  se: SeEvent[];
  /** 動画全体の長さ（秒） */
  duration: number;
}

/** 各カットの開始時刻と表示時間（決定的。書き出し時の映像フレームもこれに従う） */
export function cutTimings(cuts: Cut[]): CutTiming[] {
  const timings: CutTiming[] = [];
  let t = 0;
  for (const cut of cuts) {
    const duration = cut.waitSeconds ?? DEFAULT_CUT_SECONDS;
    timings.push({ start: t, duration });
    t += duration;
  }
  return timings;
}

/** カット列から音声タイムラインを導出する */
export function buildAudioTimeline(cuts: Cut[]): AudioTimeline {
  const timings = cutTimings(cuts);
  const duration =
    timings.length > 0
      ? timings[timings.length - 1].start + timings[timings.length - 1].duration
      : 0;

  const bgm: BgmSegment[] = [];
  const se: SeEvent[] = [];
  let current: BgmSegment | null = null;

  cuts.forEach((cut, i) => {
    const t = timings[i].start;

    // BGMの切替・停止
    const asset = cut.bgm?.asset ?? null;
    if ((current?.asset ?? null) !== asset) {
      if (current) {
        current.end = t;
        current.fadeOutSeconds = cut.bgmFadeOutSeconds ?? 0;
        bgm.push(current);
        current = null;
      }
      if (cut.bgm) {
        current = {
          asset: cut.bgm.asset,
          start: t,
          end: duration,
          volume: cut.bgm.volume,
          fadeInSeconds: cut.bgm.fadeInSeconds,
          fadeOutSeconds: 0,
        };
      }
    } else if (current && cut.bgm && cut.bgm.volume !== current.volume) {
      // 同一トラックの音量変更は区間を分割せず、変更後の音量を区間全体に採用しない。
      // 単純化のため新しい区間として扱う（トラックは頭から再生し直しになる点に注意）
      current.end = t;
      bgm.push(current);
      current = { ...current, start: t, end: duration, volume: cut.bgm.volume, fadeInSeconds: 0, fadeOutSeconds: 0 };
    }

    if (cut.se) {
      se.push({ asset: cut.se.asset, time: t, volume: cut.se.volume });
    }
  });

  if (current) bgm.push(current);
  return { bgm, se, duration };
}
