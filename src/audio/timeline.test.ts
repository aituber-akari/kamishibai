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

describe('複数対象のダメージ・回復・@mod', () => {
  const mkChar = (name: string): Character => ({
    id: name,
    name,
    portraits: {},
    defaultExpression: 'default',
    params: {
      hp: { kind: 'pair', current: 10, max: 10 },
      mp: { kind: 'pair', current: 3, max: 3 },
    },
    showInStatusBar: true,
  });

  it('「名前… 数値」のグループで複数人に別々のダメージが入る', () => {
    const { commands, errors } = parseScript('@damage A B 5 C 3');
    expect(errors).toEqual([]);
    const { cuts, warnings } = buildCuts(commands, [mkChar('A'), mkChar('B'), mkChar('C')], mazeKingdomTemplate, {});
    expect(warnings).toEqual([]);
    const snap = cuts[0].paramsSnapshot;
    expect(snap.A.hp).toMatchObject({ current: 5 });
    expect(snap.B.hp).toMatchObject({ current: 5 });
    expect(snap.C.hp).toMatchObject({ current: 7 });
    expect(cuts[0].damagePopup).toEqual({
      paramLabel: null,
      entries: [
        { characterName: 'A', delta: -5 },
        { characterName: 'B', delta: -5 },
        { characterName: 'C', delta: -3 },
      ],
    });
  });

  it('@mod 気力 で複数人の気力を増減できる（ラベル指定・上限クランプ）', () => {
    const { commands, errors } = parseScript('@mod 気力 A -1 B +2');
    expect(errors).toEqual([]);
    const { cuts, warnings } = buildCuts(commands, [mkChar('A'), mkChar('B')], mazeKingdomTemplate, {});
    expect(warnings).toEqual([]);
    expect(cuts[0].paramsSnapshot.A.mp).toMatchObject({ current: 2 });
    expect(cuts[0].paramsSnapshot.B.mp).toMatchObject({ current: 3 }); // 最大値でクランプ
    expect(cuts[0].damagePopup?.paramLabel).toBe('気力');
  });

  it('不正な形式はエラー・未登録名は警告', () => {
    expect(parseScript('@damage 5').errors).toHaveLength(1); // 名前なし
    expect(parseScript('@damage A').errors).toHaveLength(1); // 数値なし
    expect(parseScript('@mod 気力 A 0').errors).toHaveLength(1); // 増減0
    const { commands } = parseScript('@damage A 誰か 5');
    const { warnings } = buildCuts(commands, [mkChar('A')], mazeKingdomTemplate, {});
    expect(warnings).toHaveLength(1);
  });
});

describe('戦場チップ（未登録の敵・滑走移動）', () => {
  it('未登録名のチップを警告なしで置け、画像も指定できる', () => {
    const { commands } = parseScript(['@bf', '@chip ゴブリンA 4 2 ゴブリン.png', 'GM: 敵だ！'].join('\n'));
    const { cuts, warnings } = buildCuts(commands, chars, mazeKingdomTemplate, {});
    expect(warnings).toEqual([]);
    expect(cuts[0].map?.chips).toEqual([
      { characterName: 'ゴブリンA', x: 4, y: 2, image: 'ゴブリン.png', from: undefined },
    ]);
  });

  it('チップ移動は直後のカットにだけ from が付く（滑走は一度きり）', () => {
    const { commands } = parseScript(
      ['@bf', '@chip ゴブリンA 4 2', 'GM: 出現', '@chip ゴブリンA 3 2', 'GM: 前進してきた！', 'GM: にらみ合い'].join('\n'),
    );
    const { cuts } = buildCuts(commands, chars, mazeKingdomTemplate, {});
    const chipAt = (i: number) => cuts[i].map!.chips[0];
    expect(chipAt(0).from).toBeUndefined(); // 新規配置は滑走しない
    expect(chipAt(1)).toMatchObject({ x: 3, y: 2, from: { x: 4, y: 2 } }); // 移動直後のカット
    expect(chipAt(2).from).toBeUndefined(); // 次のカットでは静止
  });
});

describe('演出カット（@damage/@dice）は直前のセリフを残す', () => {
  const taro: Character = {
    id: 'taro',
    name: '太郎',
    portraits: {},
    defaultExpression: 'default',
    params: { hp: { kind: 'pair', current: 10, max: 10 } },
    showInStatusBar: true,
  };

  it('@damage / @dice のカットにも直前のメッセージが乗り、次のセリフで更新される', () => {
    const { commands } = parseScript(
      ['太郎: いくぞ', '@damage 太郎 3', '@dice 2d6 8', '太郎: やった'].join('\n'),
    );
    const { cuts } = buildCuts(commands, [taro], mazeKingdomTemplate, {});
    expect(cuts).toHaveLength(4);
    expect(cuts[0].message).toMatchObject({ speaker: '太郎', text: 'いくぞ' });
    // @damage カット: ポップは出るがメッセージは直前のまま（空にならない）
    expect(cuts[1].damagePopup).not.toBeNull();
    expect(cuts[1].message).toMatchObject({ speaker: '太郎', text: 'いくぞ' });
    // @dice カットも同様に直前のセリフを保持
    expect(cuts[2].dice).not.toBeNull();
    expect(cuts[2].message).toMatchObject({ speaker: '太郎', text: 'いくぞ' });
    // 次のセリフで更新される
    expect(cuts[3].message).toMatchObject({ speaker: '太郎', text: 'やった' });
  });

  it('セリフより前の演出カットはメッセージ無し（残すべき直前のセリフがない）', () => {
    const { commands } = parseScript(['@damage 太郎 3', '太郎: いくぞ'].join('\n'));
    const { cuts } = buildCuts(commands, [taro], mazeKingdomTemplate, {});
    expect(cuts[0].damagePopup).not.toBeNull();
    expect(cuts[0].message).toBeNull();
  });
});

describe('@text ブロック（テキスト画面）', () => {
  it('@end までの行を字下げ・空行込みで収集し、@text off で解除する', () => {
    const src = [
      '@text black',
      '@c ～お宝表～',
      '',
      '天狗：',
      '　木の素材10個   ',
      '@end',
      '@text off',
      'GM: 以上だ',
    ].join('\n');
    const { commands, errors } = parseScript(src);
    expect(errors).toEqual([]);
    const { cuts } = buildCuts(commands, chars, mazeKingdomTemplate, {});
    expect(cuts).toHaveLength(2);
    expect(cuts[0].textScreen).toEqual({
      bgColor: 'black',
      lines: ['@c ～お宝表～', '', '天狗：', '　木の素材10個'], // 字下げ保持・行末空白除去
    });
    expect(cuts[1].textScreen).toBeNull();
  });

  it('@end が無ければエラー', () => {
    expect(parseScript('@text\nこんにちは').errors).toHaveLength(1);
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
