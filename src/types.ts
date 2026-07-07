// ============ ゲームテンプレート ============

/** パラメータの種類: pair=現在値/最大値, number=単一数値, text=文字列 */
export type ParamKind = 'pair' | 'number' | 'text';

export interface ParamDef {
  key: string;
  label: string;
  kind: ParamKind;
  /** pair/number の初期値 */
  defaultValue?: number;
  /** text の初期値 */
  defaultText?: string;
}

/** ゲームシステムごとのステータス項目定義（迷キン以外はテンプレート追加で対応） */
export interface GameTemplate {
  id: string;
  name: string;
  /** キャラクター個別のパラメータ（ステータスバーに並ぶ） */
  characterParams: ParamDef[];
  /** 全体パネル（迷キンなら王国情報: 民の声・ターン・食事・生産力など） */
  globalParams: ParamDef[];
  /** ダメージ/回復コマンドが増減させる pair パラメータの key */
  damageParamKey: string;
}

export type ParamValue =
  | { kind: 'pair'; current: number; max: number }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string };

// ============ キャラクター ============

export interface Character {
  id: string;
  name: string;
  /** 表情名 → アセット名（立ち絵画像） */
  portraits: Record<string, string>;
  /** 省略時に使う表情名 */
  defaultExpression: string;
  /** 顔アイコン（ステータスバー用）のアセット名 */
  faceIcon?: string;
  /** パラメータ初期値（テンプレートの characterParams に対応） */
  params: Record<string, ParamValue>;
  /** ステータスバーに表示するか */
  showInStatusBar: boolean;
}

// ============ 脚本コマンド ============

export type StagePosition = 'left' | 'center' | 'right';

export type ScriptCommand =
  | { type: 'bg'; asset: string; line: number }
  | { type: 'bgm'; asset: string | null; line: number } // null = stop
  | { type: 'se'; asset: string; line: number }
  | { type: 'show'; name: string; expression?: string; position?: StagePosition; line: number }
  | { type: 'hide'; name: string; line: number }
  | { type: 'damage'; name: string; amount: number; line: number }
  | { type: 'heal'; name: string; amount: number; line: number }
  | { type: 'set'; name: string; param: string; value: string; line: number }
  | { type: 'dice'; spec: string; result: string; line: number }
  | { type: 'status'; visible: boolean; line: number }
  | { type: 'wait'; seconds: number; line: number }
  | { type: 'say'; name: string; expression?: string; text: string; line: number };

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  commands: ScriptCommand[];
  errors: ParseError[];
}

// ============ カット（描画状態） ============

export interface PortraitState {
  characterName: string;
  /** このカットで使う表情 */
  expression: string;
  position: StagePosition;
}

export interface DamagePopup {
  characterName: string;
  amount: number; // 正=ダメージ, 負=回復
}

export interface DiceEffect {
  spec: string;
  result: string;
}

/** 1カット = プレビュー/動画の1画面ぶんの完全な描画状態 */
export interface Cut {
  index: number;
  /** 脚本上の行番号（エディタ連携用） */
  line: number;
  bg: string | null;
  bgm: string | null;
  /** このカットで鳴らすSE */
  se: string | null;
  portraits: PortraitState[];
  statusVisible: boolean;
  /** キャラ名 → パラメータのスナップショット */
  paramsSnapshot: Record<string, Record<string, ParamValue>>;
  globalSnapshot: Record<string, ParamValue>;
  message: { speaker: string; text: string } | null;
  damagePopup: DamagePopup | null;
  dice: DiceEffect | null;
  /** 表示時間（秒）。wait 指定がなければ再生側の既定値 */
  waitSeconds: number | null;
}

// ============ プロジェクト ============

export interface Project {
  name: string;
  templateId: string;
  characters: Character[];
  script: string;
  /** 全体パラメータ初期値 */
  globalParams: Record<string, ParamValue>;
}
