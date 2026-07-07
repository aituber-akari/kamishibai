import type {
  Character,
  Cut,
  GameTemplate,
  MapState,
  ParamValue,
  ParseError,
  PortraitState,
  ScriptCommand,
} from '../types';

/** wait 指定がないカットの既定表示時間（秒）。プレビューとmp4書き出しで共有する */
export const DEFAULT_CUT_SECONDS = 2.5;

export interface BuildResult {
  cuts: Cut[];
  /** 未登録キャラ名の指定など、実行はできるが意図とズレていそうな箇所 */
  warnings: ParseError[];
}

interface FoldState {
  bg: string | null;
  bgm: string | null;
  statusVisible: boolean;
  map: MapState | null;
  portraits: PortraitState[];
  params: Record<string, Record<string, ParamValue>>;
  globals: Record<string, ParamValue>;
}

/**
 * ScriptCommand の列をカット（1画面ぶんの描画状態）の列に畳み込む。
 * @damage / @heal / @set はここでパラメータへ反映されるため、
 * 以降のカットのステータスバーには自動で新しい値が表示される。
 */
export function buildCuts(
  commands: ScriptCommand[],
  characters: Character[],
  template: GameTemplate,
  globalParams: Record<string, ParamValue>,
): BuildResult {
  const warnings: ParseError[] = [];
  const state: FoldState = {
    bg: null,
    bgm: null,
    statusVisible: true,
    map: null,
    portraits: [],
    params: Object.fromEntries(characters.map((c) => [c.name, structuredClone(c.params)])),
    globals: structuredClone(globalParams),
  };

  const charByName = new Map(characters.map((c) => [c.name, c]));
  const cuts: Cut[] = [];

  // 次のセリフ行に乗せる一時演出
  let pendingSe: string | null = null;
  let pendingDamage: Cut['damagePopup'] = null;
  let pendingDice: Cut['dice'] = null;
  let pendingWait: number | null = null;

  const pushCut = (message: Cut['message'], line: number) => {
    cuts.push({
      index: cuts.length,
      line,
      bg: state.bg,
      bgm: state.bgm,
      se: pendingSe,
      map: state.map ? { asset: state.map.asset, chips: state.map.chips.map((c) => ({ ...c })) } : null,
      portraits: state.portraits.map((p) => ({ ...p })),
      statusVisible: state.statusVisible,
      paramsSnapshot: structuredClone(state.params),
      globalSnapshot: structuredClone(state.globals),
      message,
      damagePopup: pendingDamage,
      dice: pendingDice,
      waitSeconds: pendingWait,
    });
    pendingSe = null;
    pendingDamage = null;
    pendingDice = null;
    pendingWait = null;
  };

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'bg':
        state.bg = cmd.asset;
        break;
      case 'bgm':
        state.bgm = cmd.asset;
        break;
      case 'se':
        pendingSe = cmd.asset;
        break;
      case 'status':
        state.statusVisible = cmd.visible;
        break;
      case 'map':
        // マップを消すとチップも消える。マップ差し替え時はチップを維持する
        state.map = cmd.asset === null ? null : { asset: cmd.asset, chips: state.map?.chips ?? [] };
        break;
      case 'chip': {
        if (!state.map) {
          warnings.push({ line: cmd.line, message: '@chip の前に @map でマップを表示してください' });
          break;
        }
        if (!charByName.has(cmd.name)) {
          warnings.push({ line: cmd.line, message: `「${cmd.name}」は未登録のキャラクターです（@chip は無視されます）` });
          break;
        }
        state.map.chips = state.map.chips.filter((c) => c.characterName !== cmd.name);
        if (cmd.x !== null && cmd.y !== null) {
          state.map.chips.push({ characterName: cmd.name, x: cmd.x, y: cmd.y });
        }
        break;
      }
      case 'wait':
        pendingWait = cmd.seconds;
        break;
      case 'show': {
        const ch = charByName.get(cmd.name);
        const expression = cmd.expression ?? ch?.defaultExpression ?? 'default';
        const existing = state.portraits.find((p) => p.characterName === cmd.name);
        if (existing) {
          existing.expression = expression;
          if (cmd.position) existing.position = cmd.position;
        } else {
          state.portraits.push({
            characterName: cmd.name,
            expression,
            position: cmd.position ?? 'left',
          });
        }
        break;
      }
      case 'hide':
        state.portraits = state.portraits.filter((p) => p.characterName !== cmd.name);
        break;
      case 'damage':
      case 'heal': {
        if (!state.params[cmd.name]) {
          warnings.push({ line: cmd.line, message: `「${cmd.name}」は未登録のキャラクターです（@${cmd.type} は無視されます）` });
          break;
        }
        const delta = cmd.type === 'damage' ? -cmd.amount : cmd.amount;
        applyDelta(state.params[cmd.name], template.damageParamKey, delta);
        pendingDamage = { characterName: cmd.name, amount: cmd.type === 'damage' ? cmd.amount : -cmd.amount };
        // ダメージ演出はそれ単体でも1カットにする（セリフなしでポップ表示）
        pushCut(null, cmd.line);
        break;
      }
      case 'set': {
        const target = state.params[cmd.name];
        if (!target) {
          warnings.push({ line: cmd.line, message: `「${cmd.name}」は未登録のキャラクターです（@set は無視されます。全体パラメータは @setglobal を使ってください）` });
          break;
        }
        setParam(target, cmd.param, cmd.value, template);
        break;
      }
      case 'setglobal':
        setParam(state.globals, cmd.param, cmd.value, template);
        break;
      case 'dice':
        if (cmd.name && !charByName.has(cmd.name)) {
          warnings.push({ line: cmd.line, message: `「${cmd.name}」は未登録のキャラクターです（既定のダイスで表示します）` });
        }
        pendingDice = { spec: cmd.spec, result: cmd.result, characterName: cmd.name };
        pushCut(null, cmd.line);
        break;
      case 'say': {
        const ch = charByName.get(cmd.name);
        if (ch) {
          // 話者の立ち絵を自動表示・表情差分を自動差し替え
          const expression = cmd.expression ?? ch.defaultExpression;
          const existing = state.portraits.find((p) => p.characterName === cmd.name);
          if (existing) existing.expression = expression;
          else state.portraits.push({ characterName: cmd.name, expression, position: 'left' });
        }
        pushCut({ speaker: cmd.name, text: cmd.text }, cmd.line);
        break;
      }
    }
  }

  return { cuts, warnings };
}

function applyDelta(
  params: Record<string, ParamValue> | undefined,
  key: string,
  delta: number,
): void {
  if (!params) return;
  const v = params[key];
  if (v?.kind === 'pair') {
    v.current = Math.max(0, Math.min(v.max, v.current + delta));
  } else if (v?.kind === 'number') {
    v.value += delta;
  }
}

function setParam(
  params: Record<string, ParamValue>,
  keyOrLabel: string,
  value: string,
  template: GameTemplate,
): void {
  // key 直指定のほか、テンプレートのラベル（「状態」など）でも指定できるようにする
  const defs = [...template.characterParams, ...template.globalParams];
  const def = defs.find((d) => d.key === keyOrLabel || d.label === keyOrLabel);
  const key = def?.key ?? keyOrLabel;
  const existing = params[key];

  if (existing?.kind === 'pair') {
    // 「12/15」形式なら current/max を両方更新、数値のみなら current のみ
    const pair = value.match(/^(\d+)\/(\d+)$/);
    if (pair) {
      existing.current = Number(pair[1]);
      existing.max = Number(pair[2]);
    } else if (Number.isFinite(Number(value))) {
      existing.current = Number(value);
    }
  } else if (existing?.kind === 'number') {
    if (Number.isFinite(Number(value))) existing.value = Number(value);
  } else {
    params[key] = { kind: 'text', value };
  }
}
