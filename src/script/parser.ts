import type { ParseError, ParseResult, ScriptCommand, StagePosition } from '../types';

const POSITIONS: StagePosition[] = ['left', 'center', 'right'];

/**
 * 脚本テキストを ScriptCommand の列に変換する。
 *
 * 記法:
 *   @bg 森.png / @bgm 戦闘.mp3 / @bgm stop / @se ダイス.wav
 *   @show 名前 [表情] [left|center|right] / @hide 名前
 *   @damage 名前 5 / @heal 名前 3 / @set 名前 パラメータ 値
 *   @dice 2d6 8 / @status on|off / @wait 1.5
 *   名前: セリフ / 名前(表情): セリフ
 *   # コメント
 */
export function parseScript(source: string): ParseResult {
  const commands: ScriptCommand[] = [];
  const errors: ParseError[] = [];

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let raw = lines[i].trim();
    // 行頭コメント（全角＃も許容）。セリフ中の「#」を壊さないよう、
    // 行中コメントはコマンド行（@）でのみ許可する
    if (raw === '' || raw.startsWith('#') || raw.startsWith('＃')) continue;

    // @text ブロック: @end までの行を字下げ・空行込みでそのまま収集する
    const textStart = raw.match(/^[@＠]text(?:\s+(.*))?$/);
    if (textStart && textStart[1]?.trim() !== 'off') {
      const bgColor = parseTextBg(textStart[1]?.trim(), lineNo, errors);
      const body: string[] = [];
      let closed = false;
      while (i + 1 < lines.length) {
        i++;
        if (/^[@＠]end\s*$/.test(lines[i].trim())) {
          closed = true;
          break;
        }
        body.push(lines[i].replace(/\s+$/, ''));
      }
      if (!closed) {
        errors.push({ line: lineNo, message: '@text に対応する @end がありません' });
        continue;
      }
      // 先頭・末尾の空行は落とす（間の空行は行間として維持）
      while (body.length > 0 && body[0] === '') body.shift();
      while (body.length > 0 && body[body.length - 1] === '') body.pop();
      commands.push({ type: 'text', lines: body, bgColor, line: lineNo });
      continue;
    }

    if (raw.startsWith('@') || raw.startsWith('＠')) {
      raw = raw.replace(/\s[#＃].*$/, '').trim();
      const cmd = parseCommand(raw, lineNo, errors);
      if (cmd) commands.push(cmd);
      continue;
    }

    // セリフ行: 名前: テキスト（全角コロンも許容）
    const say = raw.match(/^([^:：()（）]+?)(?:[（(]([^)）]+)[)）])?\s*[:：]\s*(.*)$/);
    if (say) {
      const [, name, expression, text] = say;
      commands.push({ type: 'say', name: name.trim(), expression: expression?.trim(), text, line: lineNo });
      continue;
    }

    errors.push({ line: lineNo, message: `解釈できない行です: 「${truncate(raw)}」（セリフは「名前: テキスト」の形式で書いてください）` });
  }

  return { commands, errors };
}

function parseCommand(raw: string, line: number, errors: ParseError[]): ScriptCommand | null {
  const [head, ...args] = raw.slice(1).split(/\s+/);
  const err = (message: string) => {
    errors.push({ line, message });
    return null;
  };

  switch (head) {
    case 'bg':
      if (!args[0]) return err('@bg には背景のファイル名が必要です');
      return { type: 'bg', asset: args[0], line };
    case 'bgm': {
      // 「@bgm 戦闘.mp3 [音量0-1] [fade|fade=秒]」「@bgm stop [fade=秒]」
      if (!args[0]) return err('@bgm にはファイル名か stop が必要です');
      const opts = parseAudioOptions(args.slice(1));
      if (opts.error) return err(`@bgm: ${opts.error}`);
      return {
        type: 'bgm',
        asset: args[0] === 'stop' ? null : args[0],
        volume: opts.volume,
        fadeSeconds: opts.fadeSeconds,
        line,
      };
    }
    case 'se': {
      // 「@se ダイス.wav [音量0-1]」
      if (!args[0]) return err('@se にはファイル名が必要です');
      const opts = parseAudioOptions(args.slice(1));
      if (opts.error) return err(`@se: ${opts.error}`);
      return { type: 'se', asset: args[0], volume: opts.volume, line };
    }
    case 'show': {
      if (!args[0]) return err('@show にはキャラクター名が必要です');
      const rest = args.slice(1);
      let position: StagePosition | undefined;
      let expression: string | undefined;
      let flip: boolean | undefined;
      for (const a of rest) {
        if ((POSITIONS as string[]).includes(a)) position = a as StagePosition;
        else if (a === 'flip') flip = true;
        else if (a === 'noflip') flip = false;
        else expression = a;
      }
      return { type: 'show', name: args[0], expression, position, flip, line };
    }
    case 'hide':
      if (!args[0]) return err('@hide にはキャラクター名が必要です');
      return { type: 'hide', name: args[0], line };
    case 'damage':
    case 'heal': {
      const amount = Number(args[1]);
      if (!args[0] || !Number.isFinite(amount) || amount <= 0)
        return err(`@${head} は「@${head} 名前 正の数値」の形式です`);
      return { type: head, name: args[0], amount, line };
    }
    case 'set':
      if (args.length < 3) return err('@set は「@set 名前 パラメータ 値」の形式です');
      return { type: 'set', name: args[0], param: args[1], value: args.slice(2).join(' '), line };
    case 'setglobal':
      if (args.length < 2) return err('@setglobal は「@setglobal パラメータ 値」の形式です');
      return { type: 'setglobal', param: args[0], value: args.slice(1).join(' '), line };
    case 'dice': {
      // 「@dice 2d6 8」または「@dice キャラ名 2d6 8」
      if (args.length < 2) return err('@dice は「@dice [キャラ名] 2d6 出目」の形式です');
      const isSpec = (s: string) => /^\d*[dD]\d+/.test(s);
      if (isSpec(args[0])) {
        return { type: 'dice', spec: args[0], result: args.slice(1).join(' '), line };
      }
      if (args.length < 3 || !isSpec(args[1]))
        return err('@dice は「@dice [キャラ名] 2d6 出目」の形式です（ダイス指定は 2d6 のような形式）');
      return { type: 'dice', name: args[0], spec: args[1], result: args.slice(2).join(' '), line };
    }
    case 'map':
      if (!args[0]) return err('@map にはマップ画像のファイル名か off が必要です');
      return { type: 'map', asset: args[0] === 'off' ? null : args[0], line };
    case 'bf':
      // 生成戦場マップ。引数なしで標準の6列（味方本陣〜敵本陣）、
      // ラベルを並べれば特殊戦場、@bf off で消去
      if (!args[0]) return { type: 'bf', lanes: [], line };
      if (args[0] === 'off') return { type: 'bf', lanes: null, line };
      return { type: 'bf', lanes: args, line };
    case 'lane': {
      // 「@lane 2 danger」「@lane 2 罠原 danger」「@lane 2 罠原」— 戦場トラップの発動等
      const index = Number(args[0]);
      if (!Number.isInteger(index) || index < 1)
        return err('@lane は「@lane 列番号 [ラベル] [danger|normal]」の形式です（列番号は1始まり）');
      let label: string | undefined;
      let state: 'normal' | 'danger' | undefined;
      for (const a of args.slice(1)) {
        if (a === 'danger' || a === 'normal') state = a;
        else label = a;
      }
      if (!label && !state) return err('@lane にはラベルか状態（danger/normal）のどちらかが必要です');
      return { type: 'lane', index, label, state, line };
    }
    case 'trap': {
      // 「@trap 3 地雷原」— 列3を改名して危険表示に。「@trap 3 off」で元の名前に戻して解除
      const index = Number(args[0]);
      if (!Number.isInteger(index) || index < 1 || !args[1])
        return err('@trap は「@trap 列番号 罠名」または「@trap 列番号 off」の形式です');
      return { type: 'trap', index, label: args[1] === 'off' ? null : args.slice(1).join(' '), line };
    }
    case 'mark': {
      // 「@mark 3 2 死」「@mark 3 2 off」— 白札マーカー
      const x = Number(args[0]);
      const y = Number(args[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !args[2])
        return err('@mark は「@mark x y テキスト」または「@mark x y off」の形式です');
      return { type: 'mark', x, y, text: args[2] === 'off' ? null : args.slice(2).join(' '), line };
    }
    case 'chip': {
      // 「@chip 名前 x y」（x,y はマップに対する% 0-100）または「@chip 名前 off」
      if (!args[0]) return err('@chip は「@chip 名前 x y」または「@chip 名前 off」の形式です');
      if (args[1] === 'off') return { type: 'chip', name: args[0], x: null, y: null, line };
      const x = Number(args[1]);
      const y = Number(args[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y))
        return err('@chip の座標はマップに対する%（0-100）で「@chip 名前 25 40」のように指定します');
      return { type: 'chip', name: args[0], x, y, line };
    }
    case 'name':
      // 「@name モブ 村長」— ステータスバー等の恒常表示名をそのカット以降変更する
      if (args.length < 2) return err('@name は「@name キャラ名 新表示名」の形式です');
      return { type: 'name', name: args[0], newName: args.slice(1).join(' '), line };
    case 'status':
      if (args[0] !== 'on' && args[0] !== 'off') return err('@status は on か off を指定してください');
      return { type: 'status', visible: args[0] === 'on', line };
    case 'fadeout':
    case 'fadein': {
      // 「@fadeout [秒] [white|black|#rrggbb]」既定は1秒・黒。ホワイトアウトは white（白でも可）
      let seconds = 1;
      let color = 'black';
      for (const a of args) {
        if (Number.isFinite(Number(a))) {
          seconds = Number(a);
        } else if (a === 'white' || a === '白') {
          color = 'white';
        } else if (a === 'black' || a === '黒') {
          color = 'black';
        } else if (/^#[0-9a-fA-F]{6}$/.test(a)) {
          color = a;
        } else {
          return err(`@${head}: 解釈できない指定です: ${a}（秒数 / white / black / #rrggbb）`);
        }
      }
      if (seconds <= 0) return err(`@${head} の秒数は正の数で指定してください`);
      return { type: head, seconds, color, line };
    }
    case 'still': {
      // 「@still 画像 [音声] [秒] [背景色]」一枚絵の全画面表示。「@still off」で解除。
      // 音声を指定し秒を省略すると、カットの長さが音声の長さになる
      if (!args[0]) return err('@still は「@still 画像 [音声] [秒] [背景色]」または「@still off」の形式です');
      if (args[0] === 'off') return { type: 'still', asset: null, bgColor: 'white', line };
      let audio: string | undefined;
      let seconds: number | undefined;
      let bgColor = 'white';
      for (const a of args.slice(1)) {
        if (Number.isFinite(Number(a))) {
          const n = Number(a);
          if (n <= 0) return err('@still の秒数は正の数で指定してください');
          seconds = n;
        } else if (a === 'white' || a === '白') bgColor = 'white';
        else if (a === 'black' || a === '黒') bgColor = 'black';
        else if (/^#[0-9a-fA-F]{6}$/.test(a)) bgColor = a;
        else audio = a;
      }
      return { type: 'still', asset: args[0], audio, seconds, bgColor, line };
    }
    case 'text':
      // ブロック開始はメインループで処理済み。ここに来るのは「@text off」のみ
      if (args[0] === 'off') return { type: 'text', lines: null, bgColor: 'black', line };
      return err('@text は「@text [色] 〜 @end」のブロック、または「@text off」で使います');
    case 'fontsize': {
      // 「@fontsize 2.5」メッセージ文字の倍率。「@fontsize 1」「@fontsize off」で戻す
      if (args[0] === 'off') return { type: 'fontsize', scale: 1, line };
      const scale = Number(args[0]);
      if (!Number.isFinite(scale) || scale < 0.5 || scale > 5)
        return err('@fontsize は 0.5〜5 の倍率か off を指定してください');
      return { type: 'fontsize', scale, line };
    }
    case 'wait': {
      const seconds = Number(args[0]);
      if (!Number.isFinite(seconds) || seconds <= 0) return err('@wait には正の秒数が必要です');
      return { type: 'wait', seconds, line };
    }
    default:
      return err(`未知のコマンドです: @${head}`);
  }
}

/** @text の背景色引数（省略時は黒） */
function parseTextBg(arg: string | undefined, line: number, errors: ParseError[]): string {
  if (!arg) return 'black';
  if (arg === 'white' || arg === '白') return 'white';
  if (arg === 'black' || arg === '黒') return 'black';
  if (/^#[0-9a-fA-F]{6}$/.test(arg)) return arg;
  errors.push({ line, message: `@text: 解釈できない背景色です: ${arg}（white/black/#rrggbb）` });
  return 'black';
}

/** 既定のフェード秒（「fade」とだけ書いたとき） */
const DEFAULT_FADE_SECONDS = 1.5;

/** @bgm/@se の追加引数（音量・フェード）を解釈する */
function parseAudioOptions(args: string[]): {
  volume?: number;
  fadeSeconds?: number;
  error?: string;
} {
  let volume: number | undefined;
  let fadeSeconds: number | undefined;
  for (const a of args) {
    if (a === 'fade') {
      fadeSeconds = DEFAULT_FADE_SECONDS;
    } else if (a.startsWith('fade=')) {
      const n = Number(a.slice(5));
      if (!Number.isFinite(n) || n < 0) return { error: `fade= には0以上の秒数を指定してください: ${a}` };
      fadeSeconds = n;
    } else if (Number.isFinite(Number(a))) {
      const n = Number(a);
      if (n < 0 || n > 1) return { error: `音量は 0〜1 で指定してください: ${a}` };
      volume = n;
    } else {
      return { error: `解釈できない指定です: ${a}（音量0-1 / fade / fade=秒）` };
    }
  }
  return { volume, fadeSeconds };
}

function truncate(s: string, n = 20): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
