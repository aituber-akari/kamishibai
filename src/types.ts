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

/** 生成戦場マップのゲーム別設定 */
export interface BattlefieldConfig {
  /** @bf 引数なしのときの標準の列ラベル */
  defaultLanes: string[];
  /** 列あたりの行数 */
  rows: number;
  /** ラベルに含まれると味方/敵側の配色になるキーワード */
  sideKeywords: { ally: string[]; enemy: string[] };
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
  /** 生成戦場マップの設定（@bf を使わないゲームでは省略可） */
  battlefield?: BattlefieldConfig;
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
  /**
   * 立ち絵の表示倍率（既定 1.0）。
   * 素材はキャラごとに解像度がバラバラなので、基準サイズに自動フィット後この倍率を掛ける
   */
  portraitScale?: number;
  /** 立ち絵の縦位置オフセット（px、正で下へ） */
  portraitOffsetY?: number;
  /** このキャラのダイスアニメに使う素材フォルダ（未設定ならプロジェクト既定） */
  diceFolder?: string;
  /** 顔アイコンのズーム倍率（既定 1.0 = セルにcoverフィット） */
  faceIconScale?: number;
  /** マップ用キャラチップ画像（未設定なら顔アイコンを使う） */
  chipImage?: string;
  /** キャラチップの表示倍率（既定 1.0） */
  chipScale?: number;
  /** 右側配置のとき立ち絵を自動で左右反転する（左向き素材を向かい合わせにする用） */
  flipOnRight?: boolean;
  /**
   * このキャラに紐づける素材フォルダ（トップレベルフォルダ名、複数可）。
   * 指定すると立ち絵・アイコン等の選択候補がこのフォルダ内に絞られる。未指定なら全素材
   */
  assetFolders?: string[];
  /**
   * 別名。脚本中でこの名前を使っても同じキャラとして解決される
   * （例: PCの本名の別名にPL名を登録し、ゲーム外パートは「PL名:」で書く）。
   * 話者プレートには脚本に書いた名前がそのまま表示される
   */
  aliases?: string[];
}

// ============ 脚本コマンド ============

export type StagePosition = 'left' | 'center' | 'right';

export type ScriptCommand =
  | { type: 'bg'; asset: string; line: number }
  // asset null = stop。volume は 0-1、fadeSeconds はフェードイン/アウト秒
  | { type: 'bgm'; asset: string | null; volume?: number; fadeSeconds?: number; line: number }
  | { type: 'se'; asset: string; volume?: number; line: number }
  | { type: 'show'; name: string; expression?: string; position?: StagePosition; flip?: boolean; line: number }
  | { type: 'hide'; name: string; line: number }
  // ダメージ/回復。targets は「名前… 数値」の組（複数人・個別値に対応）
  | { type: 'damage'; targets: { name: string; amount: number }[]; line: number }
  | { type: 'heal'; targets: { name: string; amount: number }[]; line: number }
  // HP以外のパラメータ増減（気力など）。amount は符号付き
  | { type: 'mod'; param: string; targets: { name: string; amount: number }[]; line: number }
  | { type: 'set'; name: string; param: string; value: string; line: number }
  | { type: 'setglobal'; param: string; value: string; line: number }
  | { type: 'dice'; name?: string; spec: string; result: string; line: number }
  | { type: 'map'; asset: string | null; line: number } // null = 非表示
  | { type: 'bf'; lanes: string[] | null; line: number } // 生成戦場マップ。null = 非表示
  // 生成ダンジョンマップ（王国の土地も同書式）。cols/rows null = 非表示
  | { type: 'dungeon'; title: string | null; cols: number | null; rows: number | null; line: number }
  // 部屋の開示・更新。delta=true のカウンタは既存値への増減、false は設定
  | {
      type: 'room';
      x: number;
      y: number;
      w: number;
      h: number;
      name?: string;
      counters: { label: string; value: number; delta: boolean }[];
      line: number;
    }
  | { type: 'link'; x1: number; y1: number; x2: number; y2: number; line: number } // 部屋間の通路
  // 王国周辺図。cols/rows null = 非表示
  | { type: 'kingdom'; title: string | null; cols: number | null; rows: number | null; line: number }
  // 領土。lines は表示行（脚本では / 区切り）。null = 撤去
  | { type: 'terr'; x: number; y: number; lines: string[] | null; side: TerritorySide; line: number }
  | { type: 'dist'; x: number; y: number; value: number | null; line: number } // 道中マス数。null = 撤去
  | { type: 'lane'; index: number; label?: string; state?: Lane['state']; line: number }
  | { type: 'trap'; index: number; label: string | null; line: number } // null = 解除（元ラベルに戻す）
  | { type: 'chip'; name: string; x: number | null; y: number | null; image?: string; line: number } // null = 撤去
  | { type: 'mark'; x: number; y: number; text: string | null; line: number } // null = 撤去
  | { type: 'name'; name: string; newName: string; line: number } // 恒常表示名の変更
  | { type: 'fadeout'; seconds: number; color: string; line: number } // 画面のフェード（それ自体が1カット）
  | { type: 'fadein'; seconds: number; color: string; line: number } // 次のカットをフェード明けで始める
  // 一枚絵（スチル）表示。ロゴ・タイトルカード・イベント絵など。asset null = 解除。
  // audio指定時はカット尺が音声の長さになる
  | { type: 'still'; asset: string | null; audio?: string; seconds?: number; bgColor: string; line: number }
  // テキスト画面（@text 色 〜 @end のブロック）。lines null = 解除。
  // 行頭 @c は中央寄せ。立ち絵は表示されたまま重なる
  | { type: 'text'; lines: string[] | null; bgColor: string; line: number }
  | { type: 'fontsize'; scale: number; line: number } // メッセージ文字の倍率（サムネ用の巨大文字など）
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
  /** 左右反転して表示（向かい合わせの演出用） */
  flipped?: boolean;
}

export interface DamagePopupEntry {
  characterName: string;
  /** 実際の増減量（負=減少/ダメージ、正=増加/回復） */
  delta: number;
}

export interface DamagePopup {
  /** null = HP（ダメージ/回復表記）。それ以外はパラメータ名（気力など） */
  paramLabel: string | null;
  entries: DamagePopupEntry[];
}

export interface DiceEffect {
  spec: string;
  result: string;
  /** 振ったキャラクター（ダイスセットの選択に使う） */
  characterName?: string;
}

/**
 * マップ上のキャラチップ。
 * 画像マップでは百分率（0-100）、生成戦場マップでは列・行（1始まり、小数可）。
 * 未登録名（その場限りの敵など）も置ける
 */
export interface ChipState {
  characterName: string;
  x: number;
  y: number;
  /** チップ画像の指定（@chip の4番目の引数。キャラ設定より優先） */
  image?: string;
  /** 直前の位置（このカットの冒頭で from → x,y へ滑走移動する演出用） */
  from?: { x: number; y: number };
}

/** マップ上のマーカー（「死」「天」「鴉」等の白札）。座標はチップと同じ規則 */
export interface MapMark {
  x: number;
  y: number;
  text: string;
}

/** 生成戦場マップの列（レーン）。state が戦場トラップの発動状態を表すパラメータ */
export interface Lane {
  label: string;
  state: 'normal' | 'danger';
  /** @bf 時点の元ラベル。@trap 解除時にここへ戻す */
  originalLabel: string;
}

/** 王国周辺図の領土の所属。色と枠で塗り分ける（self=自国/ally=味方国/enemy=敵国/neutral=未購入等） */
export type TerritorySide = 'self' | 'ally' | 'enemy' | 'neutral';

/** 王国周辺図の1マス（領土） */
export interface Territory {
  x: number;
  y: number;
  /** 表示行（「自国領」「古い神殿」のような複数行） */
  lines: string[];
  side: TerritorySide;
}

/** 生成ダンジョンマップの開示済みの部屋。w/h > 1 でセル結合の大部屋 */
export interface DungeonRoom {
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
  /** 敵・罠などの表示カウンタ（脚本の記載順を保持） */
  counters: { label: string; value: number }[];
}

/** 部屋間の通路 */
export interface DungeonLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 戦闘マップ／ダンジョンマップの表示状態 */
export type MapState =
  | { kind: 'image'; asset: string; chips: ChipState[]; marks: MapMark[] }
  | { kind: 'lanes'; lanes: Lane[]; rows: number; chips: ChipState[]; marks: MapMark[] }
  | {
      kind: 'dungeon';
      title: string | null;
      cols: number;
      rows: number;
      rooms: DungeonRoom[];
      links: DungeonLink[];
      chips: ChipState[];
      marks: MapMark[];
    }
  | {
      kind: 'kingdom';
      title: string | null;
      cols: number;
      rows: number;
      terrs: Territory[];
      /** 出発地→攻略対象のマス数（イベント表を振る回数）の表示 */
      dists: { x: number; y: number; value: number }[];
      chips: ChipState[];
      marks: MapMark[];
    };

/** BGMの再生状態。fadeInSeconds はこのトラックが始まるときのフェードイン */
export interface BgmState {
  asset: string;
  volume: number;
  fadeInSeconds: number;
}

/** このカットで鳴らすSE */
export interface SeState {
  asset: string;
  volume: number;
}

/** 1カット = プレビュー/動画の1画面ぶんの完全な描画状態 */
export interface Cut {
  index: number;
  /** 脚本上の行番号（エディタ連携用） */
  line: number;
  bg: string | null;
  bgm: BgmState | null;
  /** このカットの頭で直前のBGMをフェードアウトさせる秒数（@bgm stop fade 等） */
  bgmFadeOutSeconds: number | null;
  se: SeState | null;
  /**
   * 一枚絵（スチル）。表示中は通常シーン（立ち絵・ステータスバー・メッセージ等）を
   * 描かず、背景色＋中央配置の画像だけを描く。@still off まで持続する
   */
  still: { asset: string; bgColor: string } | null;
  /**
   * テキスト画面（お宝表・キャラ紹介など）。背景色＋テキストブロックを描き、
   * 立ち絵はそのまま重なる（ステータスバー・メッセージ窓は隠れる）。@text off まで持続
   */
  textScreen: { lines: string[]; bgColor: string } | null;
  /** 戦闘マップ／ダンジョンマップ（背景とは別レイヤー） */
  map: MapState | null;
  portraits: PortraitState[];
  statusVisible: boolean;
  /** キャラ名 → パラメータのスナップショット */
  paramsSnapshot: Record<string, Record<string, ParamValue>>;
  /** キャラ名（登録名）→ このカット時点の表示名（@name で変更される） */
  displayNames: Record<string, string>;
  globalSnapshot: Record<string, ParamValue>;
  message: { speaker: string; text: string } | null;
  /** メッセージ本文の文字倍率（@fontsize。サムネ用の巨大文字など。既定1） */
  messageScale: number;
  damagePopup: DamagePopup | null;
  dice: DiceEffect | null;
  /** 表示時間（秒）。wait 指定がなければ再生側の既定値 */
  waitSeconds: number | null;
  /** カット冒頭をフェード明けで始める秒数（@fadein） */
  fadeInSeconds: number | null;
  /** フェードインの色（black/white/#rrggbb） */
  fadeInColor: string | null;
  /** カット全体をフェード演出にする秒数（@fadeout。waitSeconds と同じ値になる） */
  fadeOutSeconds: number | null;
  /** フェードアウトの色（black/white/#rrggbb） */
  fadeOutColor: string | null;
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
