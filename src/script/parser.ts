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
    case 'bgm':
      if (!args[0]) return err('@bgm にはファイル名か stop が必要です');
      return { type: 'bgm', asset: args[0] === 'stop' ? null : args[0], line };
    case 'se':
      if (!args[0]) return err('@se にはファイル名が必要です');
      return { type: 'se', asset: args[0], line };
    case 'show': {
      if (!args[0]) return err('@show にはキャラクター名が必要です');
      const rest = args.slice(1);
      let position: StagePosition | undefined;
      let expression: string | undefined;
      for (const a of rest) {
        if ((POSITIONS as string[]).includes(a)) position = a as StagePosition;
        else expression = a;
      }
      return { type: 'show', name: args[0], expression, position, line };
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
    case 'status':
      if (args[0] !== 'on' && args[0] !== 'off') return err('@status は on か off を指定してください');
      return { type: 'status', visible: args[0] === 'on', line };
    case 'wait': {
      const seconds = Number(args[0]);
      if (!Number.isFinite(seconds) || seconds <= 0) return err('@wait には正の秒数が必要です');
      return { type: 'wait', seconds, line };
    }
    default:
      return err(`未知のコマンドです: @${head}`);
  }
}

function truncate(s: string, n = 20): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
