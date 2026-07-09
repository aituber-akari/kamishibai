import { describe, expect, it } from 'vitest';
import { parseScript } from './parser';

describe('マクロ（@def / @call）', () => {
  it('定義した本文が @call の位置に展開される（行番号は呼び出し行）', () => {
    const src = [
      '@def 場面転換',
      '@fadeout 1',
      '@bg $1',
      '@fadein 1.5',
      '@end',
      '@call 場面転換 洞窟.png',
      'GM: 着いた',
    ].join('\n');
    const { commands, errors } = parseScript(src);
    expect(errors).toEqual([]);
    expect(commands.map((c) => c.type)).toEqual(['fadeout', 'bg', 'fadein', 'say']);
    expect(commands[1]).toMatchObject({ type: 'bg', asset: '洞窟.png', line: 6 });
  });

  it('同じマクロを引数を変えて何度でも呼べる', () => {
    const src = ['@def 転換', '@bg $1', '@end', '@call 転換 森.png', '@call 転換 城.png'].join('\n');
    const { commands, errors } = parseScript(src);
    expect(errors).toEqual([]);
    expect(commands).toMatchObject([
      { type: 'bg', asset: '森.png' },
      { type: 'bg', asset: '城.png' },
    ]);
  });

  it('マクロからマクロを呼べる（引数は伝搬する）', () => {
    const src = [
      '@def 転換',
      '@bg $1',
      '@end',
      '@def 夜明け',
      '@call 転換 $1',
      '@wait 1',
      '@end',
      '@call 夜明け 朝.png',
    ].join('\n');
    const { commands, errors } = parseScript(src);
    expect(errors).toEqual([]);
    expect(commands).toMatchObject([
      { type: 'bg', asset: '朝.png' },
      { type: 'wait', seconds: 1 },
    ]);
  });

  it('セリフ行もマクロに書ける（話者を引数にできる）', () => {
    const src = ['@def 掛け声', '$1: いくぞ！', '@end', '@call 掛け声 国王'].join('\n');
    const { commands, errors } = parseScript(src);
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ type: 'say', name: '国王', text: 'いくぞ！' });
  });

  it('サイコロチック相当（SE+ダイス）が1行で呼べる', () => {
    const src = ['@def サイコロ', '@se ダイス.wav', '@dice $1 $2', '@end', '@call サイコロ 2d6 8'].join('\n');
    const { commands, errors } = parseScript(src);
    expect(errors).toEqual([]);
    expect(commands).toMatchObject([
      { type: 'se', asset: 'ダイス.wav' },
      { type: 'dice', spec: '2d6', result: '8' },
    ]);
  });

  it('未定義マクロ・@end 忘れ・名前なしはエラー', () => {
    expect(parseScript('@call ほげ').errors).toHaveLength(1);
    expect(parseScript('@def 転換\n@bg a.png').errors).toHaveLength(1);
    expect(parseScript('@def\n@end').errors).toHaveLength(1);
    expect(parseScript('@call').errors).toHaveLength(1);
  });

  it('自分自身を呼ぶマクロは深さ制限でエラーになる', () => {
    const src = ['@def 無限', '@call 無限', '@end', '@call 無限'].join('\n');
    const { errors } = parseScript(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('深すぎます');
  });

  it('マクロ本文の @text ブロックの @end はマクロを閉じない', () => {
    const src = [
      '@def 表',
      '@text black',
      'お宝',
      '@end',
      '@text off',
      '@end',
      '@call 表',
      'GM: 以上',
    ].join('\n');
    const { commands, errors } = parseScript(src);
    expect(errors).toEqual([]);
    expect(commands.map((c) => c.type)).toEqual(['text', 'text', 'say']);
  });
});
