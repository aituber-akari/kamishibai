import { describe, expect, it } from 'vitest';
import { parseScript } from '../script/parser';
import { buildCuts, DEFAULT_CUT_SECONDS } from '../script/player';
import { buildAudioTimeline, cutTimings } from './timeline';
import { mazeKingdomTemplate } from '../templates/mazeKingdom';
import type { Character } from '../types';

const chars: Character[] = [];

function cutsFrom(script: string) {
  const { commands, errors } = parseScript(script);
  expect(errors).toEqual([]);
  return buildCuts(commands, chars, mazeKingdomTemplate, {}).cuts;
}

describe('cutTimings', () => {
  it('waitのないカットは既定秒、waitは指定秒で累積する', () => {
    const cuts = cutsFrom(['A: こんにちは', '@wait 4', 'B: ようこそ', 'C: さようなら'].join('\n'));
    const timings = cutTimings(cuts);
    expect(timings).toEqual([
      { start: 0, duration: DEFAULT_CUT_SECONDS },
      { start: DEFAULT_CUT_SECONDS, duration: 4 },
      { start: DEFAULT_CUT_SECONDS + 4, duration: DEFAULT_CUT_SECONDS },
    ]);
  });
});

describe('buildAudioTimeline', () => {
  it('BGMの開始・切替・停止が区間になる', () => {
    const cuts = cutsFrom(
      [
        '@bgm 日常.mp3 0.5',
        'A: 平和ね',
        'A: まだ平和ね',
        '@bgm 戦闘.mp3 0.8 fade',
        'A: 敵だ！',
        '@bgm stop fade=2',
        'A: 終わった……',
      ].join('\n'),
    );
    const t = buildAudioTimeline(cuts);
    const d = DEFAULT_CUT_SECONDS;

    expect(t.duration).toBeCloseTo(d * 4);
    expect(t.bgm).toHaveLength(2);

    const [daily, battle] = t.bgm;
    expect(daily).toMatchObject({ asset: '日常.mp3', start: 0, volume: 0.5, fadeInSeconds: 0 });
    expect(daily.end).toBeCloseTo(d * 2); // 戦闘.mp3 に切り替わるカットの頭で終わる
    expect(daily.fadeOutSeconds).toBeCloseTo(1.5); // fade（既定1.5秒）

    expect(battle).toMatchObject({ asset: '戦闘.mp3', volume: 0.8, fadeInSeconds: 1.5 });
    expect(battle.start).toBeCloseTo(d * 2);
    expect(battle.end).toBeCloseTo(d * 3); // stop するカットの頭で終わる
    expect(battle.fadeOutSeconds).toBeCloseTo(2);
  });

  it('BGMが最後まで続く場合は動画末尾で閉じる', () => {
    const cuts = cutsFrom(['@bgm 日常.mp3', 'A: a', 'A: b'].join('\n'));
    const t = buildAudioTimeline(cuts);
    expect(t.bgm).toHaveLength(1);
    expect(t.bgm[0].end).toBeCloseTo(t.duration);
  });

  it('SEはカット開始時刻に音量付きで発火する', () => {
    const cuts = cutsFrom(['A: 行くぞ', '@se ダイス.wav 0.7', 'A: それっ'].join('\n'));
    const t = buildAudioTimeline(cuts);
    expect(t.se).toEqual([{ asset: 'ダイス.wav', time: DEFAULT_CUT_SECONDS, volume: 0.7 }]);
  });

  it('ダメージ演出カットにもタイムラインが追従する', () => {
    const { commands } = parseScript(['A: 攻撃！', '@damage 太郎 3'].join('\n'));
    const character: Character = {
      id: 'x',
      name: '太郎',
      portraits: {},
      defaultExpression: 'default',
      params: { hp: { kind: 'pair', current: 10, max: 10 } },
      showInStatusBar: true,
    };
    const { cuts } = buildCuts(commands, [character], mazeKingdomTemplate, {});
    expect(cuts).toHaveLength(2);
    expect(buildAudioTimeline(cuts).duration).toBeCloseTo(DEFAULT_CUT_SECONDS * 2);
  });
});

describe('シーンのフェード（@fadeout / @fadein）', () => {
  it('@fadeout は指定秒の暗転カットになり、@fadein は次カットに乗る', () => {
    const cuts = cutsFrom(['A: 夜が更けた', '@fadeout 1', '@fadein 1.5', 'A: 翌朝'].join('\n'));
    expect(cuts).toHaveLength(3);
    expect(cuts[1]).toMatchObject({ fadeOutSeconds: 1, waitSeconds: 1, message: null });
    expect(cuts[2]).toMatchObject({ fadeInSeconds: 1.5, fadeOutSeconds: null });
    // 暗転カットの1秒ぶん、総尺にも反映される
    expect(cutTimings(cuts)[2].start).toBeCloseTo(DEFAULT_CUT_SECONDS + 1);
  });
});

describe('@still（一枚絵）とSE連動のカット尺', () => {
  const duration = (name: string) => (name === 'jingle.wav' ? 3.2 : undefined);

  it('@still は音声の長さがカット尺になり、@still off で通常シーンに戻る', () => {
    const { commands, errors } = parseScript(
      ['A: 開幕', '@still logo.png jingle.wav', '@still off', 'A: 本編'].join('\n'),
    );
    expect(errors).toEqual([]);
    const { cuts, warnings } = buildCuts(commands, chars, mazeKingdomTemplate, {}, duration);
    expect(warnings).toEqual([]);
    expect(cuts).toHaveLength(3);
    expect(cuts[1].still).toEqual({ asset: 'logo.png', bgColor: 'white' });
    expect(cuts[1].waitSeconds).toBeCloseTo(3.2);
    expect(cuts[1].se).toEqual({ asset: 'jingle.wav', volume: 1 });
    expect(cuts[2].still).toBeNull();
  });

  it('@still の秒数明示は音声の長さより優先。長さ不明は警告して既定値', () => {
    const { commands } = parseScript('@still logo.png jingle.wav 5');
    const { cuts } = buildCuts(commands, chars, mazeKingdomTemplate, {}, duration);
    expect(cuts[0].waitSeconds).toBe(5);

    const r2 = buildCuts(parseScript('@still logo.png 不明.wav').commands, chars, mazeKingdomTemplate, {}, duration);
    expect(r2.warnings).toHaveLength(1);
    expect(r2.cuts[0].waitSeconds).toBeNull();
  });

  it('ダイスカットは直前の @se の長さに尺を合わせる', () => {
    const { commands } = parseScript(['@se jingle.wav', '@dice 2d6 8'].join('\n'));
    const { cuts } = buildCuts(commands, chars, mazeKingdomTemplate, {}, duration);
    expect(cuts[0].dice).toMatchObject({ spec: '2d6', result: '8' });
    expect(cuts[0].waitSeconds).toBeCloseTo(3.2);
  });
});

describe('parser 音声オプション', () => {
  it('不正な音量・fade指定はエラーになる', () => {
    expect(parseScript('@bgm a.mp3 1.5').errors).toHaveLength(1);
    expect(parseScript('@bgm a.mp3 fade=-1').errors).toHaveLength(1);
    expect(parseScript('@se a.wav ほげ').errors).toHaveLength(1);
    expect(parseScript('@bgm a.mp3 0.8 fade=2').errors).toHaveLength(0);
  });
});
