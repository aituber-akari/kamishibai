import type {
  Character,
  Cut,
  GameTemplate,
  ParamValue,
  PortraitState,
  ScriptCommand,
} from '../types';

interface FoldState {
  bg: string | null;
  bgm: string | null;
  statusVisible: boolean;
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
): Cut[] {
  const state: FoldState = {
    bg: null,
    bgm: null,
    statusVisible: true,
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
        const delta = cmd.type === 'damage' ? -cmd.amount : cmd.amount;
        applyDelta(state.params[cmd.name], template.damageParamKey, delta);
        pendingDamage = { characterName: cmd.name, amount: cmd.type === 'damage' ? cmd.amount : -cmd.amount };
        // ダメージ演出はそれ単体でも1カットにする（セリフなしでポップ表示）
        pushCut(null, cmd.line);
        break;
      }
      case 'set': {
        const target = state.params[cmd.name] ?? state.globals;
        setParam(target, cmd.param, cmd.value, template);
        break;
      }
      case 'dice':
        pendingDice = { spec: cmd.spec, result: cmd.result };
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

  return cuts;
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
