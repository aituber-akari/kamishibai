import type {
  BgmState,
  Character,
  Cut,
  GameTemplate,
  MapState,
  ParamValue,
  ParseError,
  PortraitState,
  ScriptCommand,
  SeState,
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
  bgm: BgmState | null;
  statusVisible: boolean;
  map: MapState | null;
  still: { asset: string; bgColor: string } | null;
  portraits: PortraitState[];
  params: Record<string, Record<string, ParamValue>>;
  globals: Record<string, ParamValue>;
  /** 登録名 → 現在の表示名（@name で変更。ステータスバー等に使う） */
  displayNames: Record<string, string>;
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
  /** 音声素材の長さ（秒）を引く関数。@still のカット尺自動設定に使う */
  audioDuration?: (asset: string) => number | undefined,
): BuildResult {
  const warnings: ParseError[] = [];
  const state: FoldState = {
    bg: null,
    bgm: null,
    statusVisible: true,
    map: null,
    still: null,
    portraits: [],
    params: Object.fromEntries(characters.map((c) => [c.name, structuredClone(c.params)])),
    globals: structuredClone(globalParams),
    displayNames: {},
  };

  // 登録名と別名のどちらでも同じキャラに解決できるようにする
  const charByName = new Map<string, Character>();
  for (const c of characters) {
    charByName.set(c.name, c);
    for (const alias of c.aliases ?? []) {
      if (!charByName.has(alias)) charByName.set(alias, c);
    }
  }
  /** 脚本上の名前 → 登録名（未登録名はそのまま） */
  const resolve = (name: string) => charByName.get(name)?.name ?? name;
  const cuts: Cut[] = [];

  // 次のセリフ行に乗せる一時演出
  let pendingSe: SeState | null = null;
  let pendingDamage: Cut['damagePopup'] = null;
  let pendingDice: Cut['dice'] = null;
  let pendingWait: number | null = null;
  // 直前BGMのフェードアウト（@bgm 切替/stop に fade 指定があったとき、次のカットに記録）
  let pendingBgmFadeOut: number | null = null;
  // 次のカットをフェード明けで始める（@fadein）
  let pendingFadeIn: { seconds: number; color: string } | null = null;
  // このカット自体をフェード演出にする（@fadeout。pushCut 直前にのみ設定される）
  let pendingFadeOut: { seconds: number; color: string } | null = null;

  const pushCut = (message: Cut['message'], line: number) => {
    cuts.push({
      index: cuts.length,
      line,
      bg: state.bg,
      bgm: state.bgm ? { ...state.bgm } : null,
      bgmFadeOutSeconds: pendingBgmFadeOut,
      se: pendingSe,
      still: state.still ? { ...state.still } : null,
      map: structuredClone(state.map),
      portraits: state.portraits.map((p) => ({ ...p })),
      statusVisible: state.statusVisible,
      paramsSnapshot: structuredClone(state.params),
      displayNames: { ...state.displayNames },
      globalSnapshot: structuredClone(state.globals),
      message,
      damagePopup: pendingDamage,
      dice: pendingDice,
      waitSeconds: pendingWait,
      fadeInSeconds: pendingFadeIn?.seconds ?? null,
      fadeInColor: pendingFadeIn?.color ?? null,
      fadeOutSeconds: pendingFadeOut?.seconds ?? null,
      fadeOutColor: pendingFadeOut?.color ?? null,
    });
    pendingSe = null;
    pendingDamage = null;
    pendingDice = null;
    pendingWait = null;
    pendingBgmFadeOut = null;
    pendingFadeIn = null;
    pendingFadeOut = null;
  };

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'bg':
        state.bg = cmd.asset;
        break;
      case 'bgm': {
        const changed = (state.bgm?.asset ?? null) !== cmd.asset;
        if (changed && state.bgm && cmd.fadeSeconds) {
          // 切替/停止時のfadeは「直前トラックのフェードアウト」として次のカットに記録
          pendingBgmFadeOut = cmd.fadeSeconds;
        }
        state.bgm =
          cmd.asset === null
            ? null
            : {
                asset: cmd.asset,
                volume: cmd.volume ?? state.bgm?.volume ?? 0.6,
                fadeInSeconds: changed ? (cmd.fadeSeconds ?? 0) : (state.bgm?.fadeInSeconds ?? 0),
              };
        // 同一トラックのまま音量だけ変える指定にも対応
        if (!changed && state.bgm && cmd.volume !== undefined) state.bgm.volume = cmd.volume;
        break;
      }
      case 'se':
        pendingSe = { asset: cmd.asset, volume: cmd.volume ?? 1 };
        break;
      case 'status':
        state.statusVisible = cmd.visible;
        break;
      case 'map':
        // マップを消すとチップ・マーカーも消える。差し替え時は維持する
        state.map =
          cmd.asset === null
            ? null
            : { kind: 'image', asset: cmd.asset, chips: state.map?.chips ?? [], marks: state.map?.marks ?? [] };
        break;
      case 'bf': {
        if (cmd.lanes === null) {
          state.map = null;
          break;
        }
        // 引数なしはゲームテンプレート定義の標準戦場
        const bfConfig = template.battlefield;
        const labels = cmd.lanes.length > 0 ? cmd.lanes : (bfConfig?.defaultLanes ?? []);
        if (labels.length === 0) {
          warnings.push({ line: cmd.line, message: `${template.name} には標準戦場の定義がありません。@bf に列ラベルを指定してください` });
          break;
        }
        state.map = {
          kind: 'lanes',
          lanes: labels.map((label) => ({ label, state: 'normal' as const, originalLabel: label })),
          rows: bfConfig?.rows ?? 5,
          chips: state.map?.chips ?? [],
          marks: state.map?.marks ?? [],
        };
        break;
      }
      case 'trap': {
        if (state.map?.kind !== 'lanes') {
          warnings.push({ line: cmd.line, message: '@trap は @bf で生成した戦場マップに対して使います' });
          break;
        }
        const lane = state.map.lanes[cmd.index - 1];
        if (!lane) {
          warnings.push({ line: cmd.line, message: `列 ${cmd.index} はありません（戦場は ${state.map.lanes.length} 列です）` });
          break;
        }
        if (cmd.label === null) {
          lane.label = lane.originalLabel;
          lane.state = 'normal';
        } else {
          lane.label = cmd.label;
          lane.state = 'danger';
        }
        break;
      }
      case 'lane': {
        if (state.map?.kind !== 'lanes') {
          warnings.push({ line: cmd.line, message: '@lane は @bf で生成した戦場マップに対して使います' });
          break;
        }
        const lane = state.map.lanes[cmd.index - 1];
        if (!lane) {
          warnings.push({ line: cmd.line, message: `列 ${cmd.index} はありません（戦場は ${state.map.lanes.length} 列です）` });
          break;
        }
        if (cmd.label) lane.label = cmd.label;
        if (cmd.state) lane.state = cmd.state;
        break;
      }
      case 'chip': {
        if (!state.map) {
          warnings.push({ line: cmd.line, message: '@chip の前に @map か @bf でマップを表示してください' });
          break;
        }
        if (!charByName.has(cmd.name)) {
          warnings.push({ line: cmd.line, message: `「${cmd.name}」は未登録のキャラクターです（@chip は無視されます）` });
          break;
        }
        {
          const entity = resolve(cmd.name);
          state.map.chips = state.map.chips.filter((c) => c.characterName !== entity);
          if (cmd.x !== null && cmd.y !== null) {
            state.map.chips.push({ characterName: entity, x: cmd.x, y: cmd.y });
          }
        }
        break;
      }
      case 'mark': {
        if (!state.map) {
          warnings.push({ line: cmd.line, message: '@mark の前に @map か @bf でマップを表示してください' });
          break;
        }
        state.map.marks = state.map.marks.filter((m) => m.x !== cmd.x || m.y !== cmd.y);
        if (cmd.text !== null) {
          state.map.marks.push({ x: cmd.x, y: cmd.y, text: cmd.text });
        }
        break;
      }
      case 'wait':
        pendingWait = cmd.seconds;
        break;
      case 'fadeout':
        // フェードアウトはそれ自体が1カット（現在のシーンが徐々に指定色になる）
        pendingWait = cmd.seconds;
        pendingFadeOut = { seconds: cmd.seconds, color: cmd.color };
        pushCut(null, cmd.line);
        break;
      case 'fadein':
        pendingFadeIn = { seconds: cmd.seconds, color: cmd.color };
        break;
      case 'still': {
        if (cmd.asset === null) {
          // 解除はカットを作らない（次のセリフ等から通常シーンに戻る）
          state.still = null;
          break;
        }
        state.still = { asset: cmd.asset, bgColor: cmd.bgColor };
        if (cmd.audio) {
          pendingSe = { asset: cmd.audio, volume: 1 };
          if (cmd.seconds === undefined) {
            const duration = audioDuration?.(cmd.audio);
            if (duration === undefined) {
              warnings.push({
                line: cmd.line,
                message: `「${cmd.audio}」の長さを取得できません（素材未登録？）。表示時間は既定値になります`,
              });
            } else {
              pendingWait = duration;
            }
          }
        }
        if (cmd.seconds !== undefined) pendingWait = cmd.seconds;
        pushCut(null, cmd.line);
        break;
      }
      case 'show': {
        const ch = charByName.get(cmd.name);
        const entity = resolve(cmd.name);
        const expression = cmd.expression ?? ch?.defaultExpression ?? 'default';
        const existing = state.portraits.find((p) => p.characterName === entity);
        if (existing) {
          existing.expression = expression;
          if (cmd.position) existing.position = cmd.position;
          if (cmd.flip !== undefined) existing.flipped = cmd.flip;
          else if (cmd.position) existing.flipped = autoFlip(ch, existing.position);
        } else {
          const position = cmd.position ?? freePosition(state.portraits);
          state.portraits.push({
            characterName: entity,
            expression,
            position,
            flipped: cmd.flip ?? autoFlip(ch, position),
          });
        }
        break;
      }
      case 'hide': {
        const entity = resolve(cmd.name);
        state.portraits = state.portraits.filter((p) => p.characterName !== entity);
        break;
      }
      case 'damage':
      case 'heal': {
        const entity = resolve(cmd.name);
        if (!state.params[entity]) {
          warnings.push({ line: cmd.line, message: `「${cmd.name}」は未登録のキャラクターです（@${cmd.type} は無視されます）` });
          break;
        }
        const delta = cmd.type === 'damage' ? -cmd.amount : cmd.amount;
        applyDelta(state.params[entity], template.damageParamKey, delta);
        // ポップ表示は脚本に書かれた名前のまま（村長→敵兵士のような文脈を尊重）
        pendingDamage = { characterName: cmd.name, amount: cmd.type === 'damage' ? cmd.amount : -cmd.amount };
        // ダメージ演出はそれ単体でも1カットにする（セリフなしでポップ表示）
        pushCut(null, cmd.line);
        break;
      }
      case 'set': {
        const target = state.params[resolve(cmd.name)];
        if (!target) {
          warnings.push({ line: cmd.line, message: `「${cmd.name}」は未登録のキャラクターです（@set は無視されます。全体パラメータは @setglobal を使ってください）` });
          break;
        }
        setParam(target, cmd.param, cmd.value, template);
        break;
      }
      case 'name': {
        const ch = charByName.get(cmd.name);
        if (!ch) {
          warnings.push({ line: cmd.line, message: `「${cmd.name}」は未登録のキャラクターです（@name は無視されます）` });
          break;
        }
        state.displayNames[ch.name] = cmd.newName;
        break;
      }
      case 'setglobal':
        setParam(state.globals, cmd.param, cmd.value, template);
        break;
      case 'dice': {
        if (cmd.name && !charByName.has(cmd.name)) {
          warnings.push({ line: cmd.line, message: `「${cmd.name}」は未登録のキャラクターです（既定のダイスで表示します）` });
        }
        pendingDice = { spec: cmd.spec, result: cmd.result, characterName: cmd.name ? resolve(cmd.name) : undefined };
        // 直前の @se をダイスロールSEとして使う場合、@wait 未指定なら
        // カットの長さをSEの長さに合わせる（アニメと音がぴったり収まる）
        if (pendingSe && pendingWait === null) {
          const duration = audioDuration?.(pendingSe.asset);
          if (duration !== undefined) pendingWait = duration;
        }
        pushCut(null, cmd.line);
        break;
      }
      case 'say': {
        const ch = charByName.get(cmd.name); // 別名（PL名など）でも解決される
        if (ch) {
          // 話者の立ち絵を自動表示・表情差分を自動差し替え。
          // 未表示なら空いている位置へ置く（複数人の言い合いで重ならないように）
          const expression = cmd.expression ?? ch.defaultExpression;
          const existing = state.portraits.find((p) => p.characterName === ch.name);
          if (existing) {
            existing.expression = expression;
          } else {
            const position = freePosition(state.portraits);
            state.portraits.push({
              characterName: ch.name,
              expression,
              position,
              flipped: autoFlip(ch, position),
            });
          }
        }
        // 話者プレートは脚本に書かれた名前をそのまま表示する
        pushCut({ speaker: cmd.name, text: cmd.text }, cmd.line);
        break;
      }
    }
  }

  return { cuts, warnings };
}

/** 空いている立ち位置を選ぶ（左→右→中央の順） */
function freePosition(portraits: PortraitState[]): PortraitState['position'] {
  const used = new Set(portraits.map((p) => p.position));
  for (const pos of ['left', 'right', 'center'] as const) {
    if (!used.has(pos)) return pos;
  }
  return 'center';
}

/** キャラ設定「右側で自動反転」の適用 */
function autoFlip(ch: Character | undefined, position: PortraitState['position']): boolean {
  return !!ch?.flipOnRight && position === 'right';
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
