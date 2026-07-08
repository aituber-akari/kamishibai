import { describe, expect, it } from 'vitest';
import { parseScript } from './parser';
import { buildCuts } from './player';
import { mazeKingdomTemplate } from '../templates/mazeKingdom';

function cutsFrom(script: string) {
  const { commands, errors } = parseScript(script);
  expect(errors).toEqual([]);
  return buildCuts(commands, [], mazeKingdomTemplate, {});
}

describe('@dungeon のパース', () => {
  it('タイトルとサイズで開始できる', () => {
    const { commands, errors } = parseScript('@dungeon 深き渓谷 6x6');
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ type: 'dungeon', title: '深き渓谷', cols: 6, rows: 6 });
  });

  it('タイトルは省略できる（サイズのみ）', () => {
    const { commands, errors } = parseScript('@dungeon 3x3');
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ type: 'dungeon', title: null, cols: 3, rows: 3 });
  });

  it('@dungeon off で消去コマンドになる', () => {
    const { commands, errors } = parseScript('@dungeon off');
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ type: 'dungeon', cols: null, rows: null });
  });

  it('サイズ指定がない・不正な場合はエラー', () => {
    expect(parseScript('@dungeon').errors).toHaveLength(1);
    expect(parseScript('@dungeon 深き渓谷').errors).toHaveLength(1);
    expect(parseScript('@dungeon 深き渓谷 0x3').errors).toHaveLength(1);
  });
});

describe('@room のパース', () => {
  it('名前とカウンタ付きで部屋を開示できる', () => {
    const { commands, errors } = parseScript('@room 2 1 北の館 敵2 罠0');
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({
      type: 'room',
      x: 2,
      y: 1,
      w: 1,
      h: 1,
      name: '北の館',
      counters: [
        { label: '敵', value: 2, delta: false },
        { label: '罠', value: 0, delta: false },
      ],
    });
  });

  it('WxH でセル結合の大部屋になる', () => {
    const { commands, errors } = parseScript('@room 3 4 深き渓谷 2x2 敵7 罠1');
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ type: 'room', x: 3, y: 4, w: 2, h: 2, name: '深き渓谷' });
  });

  it('座標だけなら「何もない部屋」の開示になる', () => {
    const { commands, errors } = parseScript('@room 5 5');
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ type: 'room', x: 5, y: 5, name: undefined, counters: [] });
  });

  it('符号付き数値はカウンタの増減（delta）になる', () => {
    const { commands, errors } = parseScript('@room 2 1 敵-1');
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({
      type: 'room',
      counters: [{ label: '敵', value: -1, delta: true }],
    });
  });

  it('座標が無い・不正ならエラー', () => {
    expect(parseScript('@room').errors).toHaveLength(1);
    expect(parseScript('@room 北の館').errors).toHaveLength(1);
    expect(parseScript('@room 2').errors).toHaveLength(1);
  });
});

describe('@link のパース', () => {
  it('2部屋の座標で通路になる', () => {
    const { commands, errors } = parseScript('@link 2 1 3 1');
    expect(errors).toEqual([]);
    expect(commands[0]).toMatchObject({ type: 'link', x1: 2, y1: 1, x2: 3, y2: 1 });
  });

  it('座標が4つ揃わなければエラー', () => {
    expect(parseScript('@link 2 1 3').errors).toHaveLength(1);
    expect(parseScript('@link').errors).toHaveLength(1);
  });
});

describe('buildCuts: ダンジョンマップの状態展開', () => {
  it('@dungeon でマップが立ち、@room の開示が以降のカットに引き継がれる', () => {
    const { cuts, warnings } = cutsFrom(
      [
        '@dungeon 深き渓谷 6x6',
        '@room 2 1 北の館 敵2 罠0',
        'GM: 配下が帰ってきた',
        'GM: 次はどうする？',
      ].join('\n'),
    );
    expect(warnings).toEqual([]);
    expect(cuts).toHaveLength(2);
    const map = cuts[0].map;
    expect(map?.kind).toBe('dungeon');
    if (map?.kind !== 'dungeon') return;
    expect(map.title).toBe('深き渓谷');
    expect(map.cols).toBe(6);
    expect(map.rooms).toEqual([
      {
        x: 2,
        y: 1,
        w: 1,
        h: 1,
        name: '北の館',
        counters: [
          { label: '敵', value: 2 },
          { label: '罠', value: 0 },
        ],
      },
    ]);
    expect(cuts[1].map).toEqual(map); // 引き継ぎ
  });

  it('既存部屋への @room はカウンタ増減・設定・改名としてマージされる', () => {
    const { cuts, warnings } = cutsFrom(
      [
        '@dungeon 3x3',
        '@room 2 1 北の館 敵2 罠1',
        'GM: 突入！',
        '@room 2 1 敵-1',
        'GM: 一体倒した',
        '@room 2 1 罠0',
        'GM: 罠も解除',
      ].join('\n'),
    );
    expect(warnings).toEqual([]);
    const roomAt = (i: number) => {
      const m = cuts[i].map;
      return m?.kind === 'dungeon' ? m.rooms[0] : undefined;
    };
    expect(roomAt(1)?.counters).toEqual([
      { label: '敵', value: 1 },
      { label: '罠', value: 1 },
    ]);
    expect(roomAt(2)?.counters).toEqual([
      { label: '敵', value: 1 },
      { label: '罠', value: 0 },
    ]);
    expect(roomAt(2)?.name).toBe('北の館'); // 名前は維持
  });

  it('カウンタ増減は0未満にならない', () => {
    const { cuts } = cutsFrom(
      ['@dungeon 3x3', '@room 1 1 敵1', '@room 1 1 敵-5', 'GM: 全滅させた'].join('\n'),
    );
    const m = cuts[0].map;
    expect(m?.kind === 'dungeon' && m.rooms[0].counters).toEqual([{ label: '敵', value: 0 }]);
  });

  it('@link が通路として積まれ、@dungeon off でマップが消える', () => {
    const { cuts, warnings } = cutsFrom(
      ['@dungeon 3x3', '@room 1 1 王宮', '@room 2 1 病院', '@link 1 1 2 1', 'GM: 我が国だ', '@dungeon off', 'GM: 地図を閉じた'].join('\n'),
    );
    expect(warnings).toEqual([]);
    const m = cuts[0].map;
    expect(m?.kind === 'dungeon' && m.links).toEqual([{ x1: 1, y1: 1, x2: 2, y2: 1 }]);
    expect(cuts[1].map).toBeNull();
  });

  it('@chip がダンジョンマップにも乗る', () => {
    const { cuts, warnings } = cutsFrom(
      ['@dungeon 3x3', '@room 2 2 王宮', '@chip 国王 2 2', 'GM: 現在地はここ'].join('\n'),
    );
    expect(warnings).toEqual([]);
    expect(cuts[0].map?.chips).toEqual([
      { characterName: '国王', x: 2, y: 2, image: undefined, from: undefined },
    ]);
  });

  it('マップ無しの @room/@link は警告して無視される', () => {
    const { commands } = parseScript('@room 1 1 王宮\n@link 1 1 2 1\nGM: あれ？');
    const { cuts, warnings } = buildCuts(commands, [], mazeKingdomTemplate, {});
    expect(warnings).toHaveLength(2);
    expect(cuts[0].map).toBeNull();
  });
});

describe('@kingdom / @terr / @dist（王国周辺図）', () => {
  it('@kingdom で周辺図が立ち、@terr の領土が所属付きで積まれる', () => {
    const { cuts, warnings } = cutsFrom(
      [
        '@kingdom 北方領地 6x6',
        '@terr 1 2 自国領/古い神殿 自国',
        '@terr 4 1 友邦領/森 味方',
        '@terr 3 5 盗賊国/首都 敵',
        '@terr 6 4 遺跡',
        'GM: 今回の目的地はここ',
      ].join('\n'),
    );
    expect(warnings).toEqual([]);
    const m = cuts[0].map;
    expect(m?.kind).toBe('kingdom');
    if (m?.kind !== 'kingdom') return;
    expect(m.title).toBe('北方領地');
    expect(m.terrs).toEqual([
      { x: 1, y: 2, lines: ['自国領', '古い神殿'], side: 'self' },
      { x: 4, y: 1, lines: ['友邦領', '森'], side: 'ally' },
      { x: 3, y: 5, lines: ['盗賊国', '首都'], side: 'enemy' },
      { x: 6, y: 4, lines: ['遺跡'], side: 'neutral' },
    ]);
  });

  it('@dist はマスの数字として積まれ、再指定で上書き・off で消える', () => {
    const { cuts, warnings } = cutsFrom(
      [
        '@kingdom 6x6',
        '@terr 6 4 遺跡',
        '@dist 5 4 3',
        '@dist 6 4 1',
        'GM: 出発！',
        '@dist 5 4 2',
        'GM: 1マス進んだ',
        '@dist 5 4 off',
        'GM: 消した',
      ].join('\n'),
    );
    expect(warnings).toEqual([]);
    const distsAt = (i: number) => {
      const m = cuts[i].map;
      return m?.kind === 'kingdom' ? m.dists : undefined;
    };
    expect(distsAt(0)).toEqual([
      { x: 5, y: 4, value: 3 },
      { x: 6, y: 4, value: 1 },
    ]);
    expect(distsAt(1)).toEqual([
      { x: 5, y: 4, value: 2 },
      { x: 6, y: 4, value: 1 },
    ]);
    expect(distsAt(2)).toEqual([{ x: 6, y: 4, value: 1 }]);
  });

  it('@terr の再指定は上書き、off で領土が消える', () => {
    const { cuts } = cutsFrom(
      ['@kingdom 3x3', '@terr 1 1 遺跡', '@terr 1 1 自国領/遺跡 自国', 'GM: 買収した',
       '@terr 1 1 off', 'GM: 手放した'].join('\n'),
    );
    const m0 = cuts[0].map;
    expect(m0?.kind === 'kingdom' && m0.terrs).toEqual([
      { x: 1, y: 1, lines: ['自国領', '遺跡'], side: 'self' },
    ]);
    const m1 = cuts[1].map;
    expect(m1?.kind === 'kingdom' && m1.terrs).toEqual([]);
  });

  it('周辺図なしの @terr/@dist は警告、@kingdom の構文エラーも検出', () => {
    const { commands } = parseScript('@terr 1 1 自国領\n@dist 1 1 3\nGM: あれ？');
    const { warnings } = buildCuts(commands, [], mazeKingdomTemplate, {});
    expect(warnings).toHaveLength(2);
    expect(parseScript('@kingdom').errors).toHaveLength(1);
    expect(parseScript('@terr 1 王宮').errors).toHaveLength(1);
    expect(parseScript('@dist 1 1').errors).toHaveLength(1);
    expect(parseScript('@dist 1 1 ほげ').errors).toHaveLength(1);
  });
});
