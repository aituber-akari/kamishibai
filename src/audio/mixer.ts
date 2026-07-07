import type { AudioTimeline } from './timeline';

/**
 * 音声タイムラインを OfflineAudioContext でミックスダウンする（mp4書き出し用）。
 * BGMはループ・フェードイン/アウト付きで区間再生し、SEは指定時刻に単発再生する。
 */
export async function renderAudioTimeline(
  timeline: AudioTimeline,
  getAudioBlob: (asset: string) => Blob | undefined,
  sampleRate = 48000,
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(timeline.duration * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);

  // 同じ素材は一度だけデコードする
  const decodeCache = new Map<string, Promise<AudioBuffer | null>>();
  const decode = (asset: string) => {
    let p = decodeCache.get(asset);
    if (!p) {
      const blob = getAudioBlob(asset);
      p = blob
        ? blob.arrayBuffer().then(
            (buf) => ctx.decodeAudioData(buf),
            () => null,
          )
        : Promise.resolve(null);
      p = p.catch(() => null);
      decodeCache.set(asset, p);
    }
    return p;
  };

  await Promise.all([
    ...timeline.bgm.map(async (seg) => {
      const buffer = await decode(seg.asset);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();

      const fadeIn = Math.min(seg.fadeInSeconds, seg.end - seg.start);
      const fadeOut = Math.min(seg.fadeOutSeconds, seg.end - seg.start - fadeIn);
      if (fadeIn > 0) {
        gain.gain.setValueAtTime(0, seg.start);
        gain.gain.linearRampToValueAtTime(seg.volume, seg.start + fadeIn);
      } else {
        gain.gain.setValueAtTime(seg.volume, seg.start);
      }
      if (fadeOut > 0) {
        gain.gain.setValueAtTime(seg.volume, seg.end - fadeOut);
        gain.gain.linearRampToValueAtTime(0, seg.end);
      }

      source.connect(gain).connect(ctx.destination);
      source.start(seg.start);
      source.stop(seg.end + 0.01);
    }),
    ...timeline.se.map(async (ev) => {
      const buffer = await decode(ev.asset);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = ev.volume;
      source.connect(gain).connect(ctx.destination);
      source.start(ev.time);
    }),
  ]);

  return ctx.startRendering();
}
