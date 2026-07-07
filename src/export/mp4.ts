import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Character, Cut, GameTemplate } from '../types';
import {
  CANVAS_H,
  CANVAS_W,
  drawCut,
  setCanvasFont,
  type DrawOptions,
  type ImageStore,
} from '../renderer/draw';
import { buildAudioTimeline, cutTimings } from '../audio/timeline';
import { renderAudioTimeline } from '../audio/mixer';
import type { Asset } from '../hooks/useAssets';

export interface ExportOptions {
  cuts: Cut[];
  characters: Character[];
  template: GameTemplate;
  images: ImageStore;
  assets: Map<string, Asset>;
  defaultDiceFolder?: string;
  diceAnimation: boolean;
  fontFamily?: string;
  fps?: number;
  /** 0-1 の進捗（映像フレームベース） */
  onProgress?: (ratio: number) => void;
}

const VIDEO_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'];
const AUDIO_SAMPLE_RATE = 48000;

/** アセット名の解決（完全一致 → フォルダ内サフィックス一致） */
function findAsset(assets: Map<string, Asset>, name: string): Asset | undefined {
  const exact = assets.get(name);
  if (exact) return exact;
  for (const [key, a] of assets) {
    if (key.endsWith('/' + name)) return a;
  }
  return undefined;
}

async function pickVideoCodec(): Promise<string> {
  for (const codec of VIDEO_CODECS) {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec,
      width: CANVAS_W,
      height: CANVAS_H,
      bitrate: 6_000_000,
    });
    if (supported) return codec;
  }
  throw new Error('このブラウザはH.264エンコードに対応していません（Chrome/Edgeを推奨）');
}

/**
 * カット列をmp4に書き出す。
 * 映像はプレビューと同じ drawCut を1フレームずつ実行し、
 * 音声は AudioTimeline を OfflineAudioContext で合成してAACにする。
 */
export async function exportMp4(options: ExportOptions): Promise<Blob> {
  const {
    cuts,
    characters,
    template,
    images,
    assets,
    defaultDiceFolder,
    diceAnimation,
    fontFamily,
    fps = 30,
    onProgress,
  } = options;

  if (typeof VideoEncoder === 'undefined') {
    throw new Error('このブラウザはWebCodecsに対応していません（Chrome/Edgeを推奨）');
  }
  if (cuts.length === 0) throw new Error('書き出すカットがありません（脚本を書いてください）');

  const timings = cutTimings(cuts);
  const duration = timings[timings.length - 1].start + timings[timings.length - 1].duration;
  const totalFrames = Math.max(1, Math.round(duration * fps));

  // ---- 音声: タイムラインを合成（音声素材がなければ無音動画にする） ----
  const timeline = buildAudioTimeline(cuts);
  let audioBuffer: AudioBuffer | null = null;
  const usedAudio = [...timeline.bgm.map((b) => b.asset), ...timeline.se.map((s) => s.asset)];
  if (usedAudio.length > 0 && typeof AudioEncoder !== 'undefined') {
    // Object URL から Blob を引き直してミキサーへ渡す
    const blobs = new Map<string, Blob>();
    await Promise.all(
      [...new Set(usedAudio)].map(async (name) => {
        const asset = findAsset(assets, name);
        if (asset?.kind === 'audio') {
          blobs.set(name, await (await fetch(asset.url)).blob());
        }
      }),
    );
    if (blobs.size > 0) {
      audioBuffer = await renderAudioTimeline(timeline, (n) => blobs.get(n), AUDIO_SAMPLE_RATE);
    }
  }

  // ---- Muxer / エンコーダ ----
  const videoCodec = await pickVideoCodec();
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: CANVAS_W, height: CANVAS_H },
    audio: audioBuffer
      ? { codec: 'aac', numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE }
      : undefined,
    fastStart: 'in-memory',
  });

  let encodeError: unknown = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  videoEncoder.configure({
    codec: videoCodec,
    width: CANVAS_W,
    height: CANVAS_H,
    bitrate: 6_000_000,
    framerate: fps,
  });

  // ---- 映像: 全フレーム描画 → エンコード ----
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d')!;
  setCanvasFont(fontFamily);
  const drawOptions: DrawOptions = { defaultDiceFolder, diceAnimation };

  let cutIndex = 0;
  const frameMicros = 1_000_000 / fps;
  for (let i = 0; i < totalFrames; i++) {
    if (encodeError) throw encodeError;
    const t = i / fps;
    while (
      cutIndex < cuts.length - 1 &&
      t >= timings[cutIndex].start + timings[cutIndex].duration
    ) {
      cutIndex++;
    }
    drawCut(ctx, cuts[cutIndex], images, characters, template, {
      ...drawOptions,
      timeInCut: t - timings[cutIndex].start,
    });

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameMicros),
      duration: Math.round(frameMicros),
    });
    videoEncoder.encode(frame, { keyFrame: i % (fps * 5) === 0 });
    frame.close();

    // エンコーダの詰まりを避けつつ、UIにも息継ぎをさせる
    if (videoEncoder.encodeQueueSize > 8 || i % 15 === 0) {
      await new Promise((r) => setTimeout(r, 0));
      onProgress?.(i / totalFrames);
    }
  }
  await videoEncoder.flush();

  // ---- 音声: AudioBuffer → AAC ----
  if (audioBuffer) {
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => (encodeError = e),
    });
    audioEncoder.configure({
      codec: 'mp4a.40.2',
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: 2,
      bitrate: 192_000,
    });

    const chunkFrames = AUDIO_SAMPLE_RATE / 10; // 0.1秒ずつ
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
    for (let offset = 0; offset < audioBuffer.length; offset += chunkFrames) {
      if (encodeError) throw encodeError;
      const frames = Math.min(chunkFrames, audioBuffer.length - offset);
      const data = new Float32Array(frames * 2);
      data.set(ch0.subarray(offset, offset + frames), 0);
      data.set(ch1.subarray(offset, offset + frames), frames);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round((offset / AUDIO_SAMPLE_RATE) * 1_000_000),
        data,
      });
      audioEncoder.encode(audioData);
      audioData.close();
    }
    await audioEncoder.flush();
  }

  if (encodeError) throw encodeError;
  muxer.finalize();
  onProgress?.(1);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
