import type {
  Character,
  Cut,
  DamagePopup,
  DiceEffect,
  DungeonRoom,
  GameTemplate,
  MapState,
  ParamValue,
} from '../types';

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

/** ステータスバーの高さ */
const BAR_H = 132;

/** アセット名（相対パス）→ 読み込み済み画像 */
export type ImageStore = Map<string, HTMLImageElement>;

const FONT_FALLBACK = '"Hiragino Sans", "Noto Sans JP", sans-serif';
/** 既定はUDフォント（BIZ UDPゴシック、同梱） */
export const DEFAULT_FONT_FAMILY = 'BIZ UDPGothic';
let FONT = `"${DEFAULT_FONT_FAMILY}", ${FONT_FALLBACK}`;

/** 動画キャンバスのフォントを変更する（全体設定から呼ばれる） */
export function setCanvasFont(family?: string): void {
  FONT = `"${family || DEFAULT_FONT_FAMILY}", ${FONT_FALLBACK}`;
}

/** ダイスが転がっている時間（秒）。これを過ぎると出目表示に落ち着く */
export const DICE_ROLL_SECONDS = 1.0;
const DICE_FRAME_SECONDS = 1 / 15;

export interface DrawOptions {
  /** カット表示開始からの経過秒。ダイスアニメ等の時間演出に使う（省略時は演出終了後の絵） */
  timeInCut?: number;
  /** キャラにダイスセット未設定のときに使うフォルダ */
  defaultDiceFolder?: string;
  /** false でダイスの連番アニメを行わず、即座に出目を表示する */
  diceAnimation?: boolean;
}

/**
 * 1カットを Canvas に描画する純関数。
 * プレビューも mp4 書き出しも必ずこの関数を通す（見た目のズレを防ぐ）。
 * 時間演出も timeInCut からの決定的な計算にする（書き出し時に再現できるように）。
 */
export function drawCut(
  ctx: CanvasRenderingContext2D,
  cut: Cut,
  images: ImageStore,
  characters: Character[],
  template: GameTemplate,
  options: DrawOptions = {},
): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // 一枚絵（スチル）表示中は通常シーンを描かず、背景色＋中央配置の画像のみ
  if (cut.still) {
    drawStill(ctx, cut.still, images);
    drawSceneFade(ctx, cut, options);
    return;
  }

  // テキスト画面（お宝表・キャラ紹介など）: 背景色＋テキスト。立ち絵と演出は重なる
  if (cut.textScreen) {
    ctx.fillStyle = `rgb(${fadeRgb(cut.textScreen.bgColor)})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawPortraits(ctx, cut, images, characters);
    drawTextScreen(ctx, cut.textScreen);
    if (cut.dice) drawDice(ctx, cut.dice, images, characters, options);
    if (cut.damagePopup) drawDamagePopup(ctx, cut.damagePopup);
    drawSceneFade(ctx, cut, options);
    return;
  }

  drawBackground(ctx, cut, images);
  if (cut.map) drawMap(ctx, cut, cut.map, images, characters, template, options);
  drawPortraits(ctx, cut, images, characters);
  if (cut.statusVisible) drawStatusBar(ctx, cut, images, characters, template);
  if (cut.dice) drawDice(ctx, cut.dice, images, characters, options);
  if (cut.damagePopup) drawDamagePopup(ctx, cut.damagePopup);
  if (cut.message) drawMessageWindow(ctx, cut.message, cut.messageScale);
  drawSceneFade(ctx, cut, options);
}

/** 一枚絵（@still）: 指定背景色で塗りつぶし、画像を中央にアスペクト維持で収める */
function drawStill(
  ctx: CanvasRenderingContext2D,
  still: { asset: string; bgColor: string },
  images: ImageStore,
): void {
  ctx.fillStyle = `rgb(${fadeRgb(still.bgColor)})`;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const img = findImage(images, still.asset);
  if (!img) return;
  const scale = Math.min(CANVAS_W / img.width, CANVAS_H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
}

/**
 * テキスト画面（@text ブロック）。行頭「@c 」は中央寄せ。
 * 文字色は背景の明度から白/黒を自動選択する
 */
function drawTextScreen(
  ctx: CanvasRenderingContext2D,
  screen: { lines: string[]; bgColor: string },
): void {
  const lines = screen.lines;
  if (lines.length === 0) return;

  // 行数が多いほどフォントを小さく（上下マージン込みで収める）
  const fontSize = Math.max(18, Math.min(36, Math.floor((CANVAS_H * 0.88) / (lines.length * 1.55))));
  const lineHeight = fontSize * 1.55;
  ctx.save();
  ctx.font = `bold ${fontSize}px ${FONT}`;
  ctx.textBaseline = 'top';

  // 背景の明度で文字色を自動選択（白背景なら黒文字）
  const [r, g, b] = fadeRgb(screen.bgColor).split(',').map(Number);
  ctx.fillStyle = 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#111' : '#f4f4f4';

  const parsed = lines.map((line) => {
    const centered = /^@c\s+/.test(line.trim());
    return { text: centered ? line.trim().replace(/^@c\s+/, '') : line, centered };
  });
  const maxW = Math.max(...parsed.map((l) => ctx.measureText(l.text).width));
  const blockX = Math.max(70, (CANVAS_W - maxW) / 2);
  const startY = Math.max(36, (CANVAS_H - lines.length * lineHeight) / 2);

  parsed.forEach((l, i) => {
    const x = l.centered ? (CANVAS_W - ctx.measureText(l.text).width) / 2 : blockX;
    ctx.fillText(l.text, x, startY + i * lineHeight, CANVAS_W - 100);
  });
  ctx.restore();
}

/** フェード色（black/white/#rrggbb）→ RGB値 */
function fadeRgb(color: string | null): string {
  if (color === 'white') return '255, 255, 255';
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    const n = parseInt(color.slice(1), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  return '0, 0, 0';
}

/** シーン切替のフェード（@fadeout / @fadein）。オーバーレイの透過率を時刻から決める */
function drawSceneFade(ctx: CanvasRenderingContext2D, cut: Cut, options: DrawOptions): void {
  const t = options.timeInCut ?? Infinity;
  let alpha = 0;
  let color = cut.fadeOutColor ?? cut.fadeInColor;
  if (cut.fadeOutSeconds) {
    // フェードアウトカット: カット全体をかけて 0 → 1（時刻指定なしの静止表示は完了状態）
    alpha = Math.max(alpha, Math.min(1, t / cut.fadeOutSeconds));
    color = cut.fadeOutColor;
  }
  if (cut.fadeInSeconds && t < cut.fadeInSeconds) {
    const inAlpha = 1 - t / cut.fadeInSeconds;
    if (inAlpha > alpha) {
      alpha = inAlpha;
      color = cut.fadeInColor;
    }
  }
  if (alpha > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(${fadeRgb(color)}, ${alpha})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
  }
}

/**
 * アセットの検索。完全一致のほか、フォルダ登録された素材を
 * ファイル名だけで参照できるようにサフィックス一致も試す
 */
export function findImage(images: ImageStore, name: string): HTMLImageElement | undefined {
  const exact = images.get(name);
  if (exact) return exact;
  for (const [key, img] of images) {
    if (key.endsWith('/' + name)) return img;
  }
  return undefined;
}

function drawBackground(ctx: CanvasRenderingContext2D, cut: Cut, images: ImageStore): void {
  const img = cut.bg ? findImage(images, cut.bg) : undefined;
  if (img) {
    // cover でアスペクト維持して全面に描画
    const scale = Math.max(CANVAS_W / img.width, CANVAS_H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(1, '#16213e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}

function drawPortraits(
  ctx: CanvasRenderingContext2D,
  cut: Cut,
  images: ImageStore,
  characters: Character[],
): void {
  const charByName = new Map(characters.map((c) => [c.name, c]));
  // 話者名は脚本に書かれたまま（別名の可能性がある）なので登録名に解決して比較する
  const speaker = cut.message
    ? (characters.find(
        (c) => c.name === cut.message!.speaker || c.aliases?.includes(cut.message!.speaker),
      )?.name ?? cut.message.speaker)
    : null;
  const isSpeaking = (name: string) => speaker === name;

  for (const p of cut.portraits) {
    const ch = charByName.get(p.characterName);
    if (!ch) continue;
    const assetName = ch.portraits[p.expression] ?? ch.portraits[ch.defaultExpression];
    const img = assetName ? findImage(images, assetName) : undefined;
    if (!img) continue;

    // 高さ基準で自動フィット（画面の72%）した上で、キャラごとの倍率・縦位置補正を掛ける。
    // 素材の解像度がキャラごとにバラバラでも画面上のサイズを揃えられる
    const h = CANVAS_H * 0.72 * (ch.portraitScale ?? 1);
    const w = (img.width / img.height) * h;
    const y = CANVAS_H - h - 60 + (ch.portraitOffsetY ?? 0); // メッセージウィンドウの上端付近まで
    const x =
      p.position === 'left' ? 40 : p.position === 'right' ? CANVAS_W - w - 40 : (CANVAS_W - w) / 2;

    // 発言中でないキャラは少し暗く。flipped なら左右反転（向かい合わせの演出）
    const source = cut.message && !isSpeaking(p.characterName) ? darkened(img) : img;
    if (p.flipped) {
      ctx.save();
      ctx.translate(x + w / 2, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(source, -w / 2, y, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(source, x, y, w, h);
    }
  }
}

// ============ 戦闘マップ／ダンジョンマップ ============

// 表示領域: ステータスバーの下〜メッセージウィンドウの上、左は立ち絵ぶんを空ける
// メッセージウィンドウは高さ170+下マージン24=194を下部に確保する。
// マップ領域は BAR_H(132)+16 の下端から、メッセージ上端(526)まで使える
const MAP_AREA = { x: 320, y: BAR_H + 16, w: CANVAS_W - 320 - 24, h: CANVAS_H - BAR_H - 16 - 200 };

/** チップ/マーカーの論理座標 → キャンバス座標と基準サイズへの変換 */
interface MapGeometry {
  toX: (x: number) => number;
  toY: (y: number) => number;
  unit: number;
}

/** チップの滑走移動にかける時間（秒） */
export const CHIP_MOVE_SECONDS = 0.7;

function drawMap(
  ctx: CanvasRenderingContext2D,
  cut: Cut,
  map: MapState,
  images: ImageStore,
  characters: Character[],
  template: GameTemplate,
  options: DrawOptions,
): void {
  const geo =
    map.kind === 'image'
      ? drawImageMap(ctx, map, images)
      : map.kind === 'lanes'
        ? drawLanesMap(ctx, map, template)
        : map.kind === 'dungeon'
          ? drawDungeonMap(ctx, map)
          : drawKingdomMap(ctx, map);
  if (!geo) return;
  drawChips(ctx, cut, map, images, characters, template, geo, options);
  drawMarks(ctx, map, geo);
}

function drawImageMap(
  ctx: CanvasRenderingContext2D,
  map: Extract<MapState, { kind: 'image' }>,
  images: ImageStore,
): MapGeometry | null {
  const img = findImage(images, map.asset);
  if (!img) return null;
  const scale = Math.min(MAP_AREA.w / img.width, MAP_AREA.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = MAP_AREA.x + (MAP_AREA.w - w) / 2;
  const y = MAP_AREA.y + (MAP_AREA.h - h) / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 18;
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();

  // 画像マップの座標は% (0-100)
  return { toX: (px) => x + (px / 100) * w, toY: (py) => y + (py / 100) * h, unit: h * 0.1 };
}

/** 生成マップ共通のグリッドパネル（薄灰パネル＋MAPヘッダ＋座標系）を描いて幾何を返す */
function drawGridPanel(
  ctx: CanvasRenderingContext2D,
  title: string | null,
  cols: number,
  rows: number,
): { gridX: number; gridY: number; cell: number } {
  const headerH = title ? 34 : 14;
  const pad = 12;
  // 立ち絵と重なりすぎない程度に右側を使う（横は最大 85%、高さは余った下部まで）
  const cell = Math.min((MAP_AREA.w * 0.85 - pad * 2) / cols, (MAP_AREA.h - headerH - pad * 2) / rows);
  const panelW = cols * cell + pad * 2;
  const panelH = rows * cell + headerH + pad * 2;
  // スクショ準拠で右寄せ（左は立ち絵のためのスペース）
  const px = MAP_AREA.x + MAP_AREA.w - panelW;
  const py = MAP_AREA.y;
  const gridX = px + pad;
  const gridY = py + headerH + pad;

  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(198, 200, 206, 0.94)';
  ctx.beginPath();
  ctx.roundRect(px, py, panelW, panelH, 10);
  ctx.fill();
  ctx.shadowBlur = 0;

  if (title) {
    ctx.fillStyle = '#16213e';
    ctx.font = `bold ${Math.min(20, headerH * 0.6)}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`MAP：${title}`, gridX, py + headerH / 2 + 6, panelW - pad * 2);
  }
  return { gridX, gridY, cell };
}

/** グリッドの列・行座標（整数=マス中央、小数=マス内位置）→キャンバス座標の変換 */
function gridGeometry(gridX: number, gridY: number, cell: number, cols: number, rows: number): MapGeometry {
  const to = (base: number, max: number) => (v: number) => {
    const c = Math.max(1, Math.min(max, Math.floor(v)));
    const frac = v - Math.floor(v);
    return base + (frac === 0 ? c - 0.5 : c - 1 + frac) * cell;
  };
  // チップはマスの内容（部屋名・領土名）を隠さないよう控えめなサイズにする
  return { toX: to(gridX, cols), toY: to(gridY, rows), unit: cell * 0.46 };
}

/**
 * 素材不要の生成ダンジョンマップ（王国の土地も同書式）。
 * 未探索マスは白箱、@room で開示された部屋は黒枠＋名前＋カウンタで描く。
 * 通路（@link）は部屋の中心を結ぶ直線／L字線で、部屋の下に敷く
 */
function drawDungeonMap(
  ctx: CanvasRenderingContext2D,
  map: Extract<MapState, { kind: 'dungeon' }>,
): MapGeometry | null {
  if (map.cols < 1 || map.rows < 1) return null;
  ctx.save();
  const { gridX, gridY, cell } = drawGridPanel(ctx, map.title, map.cols, map.rows);

  const cellRect = (cx: number, cy: number, w = 1, h = 1) => ({
    x: gridX + (cx - 1) * cell + 2,
    y: gridY + (cy - 1) * cell + 2,
    w: w * cell - 4,
    h: h * cell - 4,
  });
  const covered = (cx: number, cy: number) =>
    map.rooms.some((r) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h);

  // 未探索マス（部屋に覆われていないマス全部）
  ctx.lineWidth = 1;
  for (let cy = 1; cy <= map.rows; cy++) {
    for (let cx = 1; cx <= map.cols; cx++) {
      if (covered(cx, cy)) continue;
      const r = cellRect(cx, cy);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = 'rgba(60,60,70,0.3)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }

  const roomAt = (cx: number, cy: number) =>
    map.rooms.find((r) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h);
  const centerOf = (cx: number, cy: number) => {
    const room = roomAt(cx, cy);
    const rx = room ? room.x + room.w / 2 - 0.5 : cx;
    const ry = room ? room.y + room.h / 2 - 0.5 : cy;
    return { x: gridX + (rx - 0.5) * cell, y: gridY + (ry - 0.5) * cell };
  };
  const arrow = (fx: number, fy: number, tx: number, ty: number) => {
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    const angle = Math.atan2(ty - fy, tx - fx);
    const head = Math.max(6, cell * 0.14);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - head * Math.cos(angle - Math.PI / 6), ty - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(tx - head * Math.cos(angle + Math.PI / 6), ty - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  };

  // どの辺に隣接通路があるかを事前計算（その辺は枠線を描かない）
  const openSides = new Map<DungeonRoom, { top: boolean; bottom: boolean; left: boolean; right: boolean }>();
  for (const room of map.rooms) openSides.set(room, { top: false, bottom: false, left: false, right: false });
  for (const link of map.links) {
    if (link.entry || link.x2 === null || link.y2 === null) continue;
    const ra = roomAt(link.x1, link.y1);
    const rb = roomAt(link.x2, link.y2);
    if (!ra || !rb) continue;
    if (ra.x + ra.w === rb.x) { openSides.get(ra)!.right = true; openSides.get(rb)!.left = true; }
    else if (rb.x + rb.w === ra.x) { openSides.get(ra)!.left = true; openSides.get(rb)!.right = true; }
    else if (ra.y + ra.h === rb.y) { openSides.get(ra)!.bottom = true; openSides.get(rb)!.top = true; }
    else if (rb.y + rb.h === ra.y) { openSides.get(ra)!.top = true; openSides.get(rb)!.bottom = true; }
  }

  // 開示済みの部屋
  for (const room of map.rooms) {
    const r = cellRect(room.x, room.y, room.w, room.h);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(20,20,30,0.85)';
    ctx.lineWidth = 2;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // 通路のある辺は枠線を省いて、部屋どうしを繋いで見せる
    const open = openSides.get(room)!;
    const sides: [boolean, number, number, number, number][] = [
      [!open.top, r.x, r.y, r.x + r.w, r.y],
      [!open.right, r.x + r.w, r.y, r.x + r.w, r.y + r.h],
      [!open.bottom, r.x, r.y + r.h, r.x + r.w, r.y + r.h],
      [!open.left, r.x, r.y, r.x, r.y + r.h],
    ];
    for (const [draw, x1, y1, x2, y2] of sides) {
      if (!draw) continue;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // 名前＋カウンタを縦に中央寄せ。マスに収まるようフォントは自動縮小。
    // 部屋内は視認性優先で全部 bold（名前・カウンタとも）
    const lines: { text: string; emphasize: boolean }[] = [];
    if (room.name) lines.push({ text: room.name, emphasize: true });
    for (const c of room.counters) lines.push({ text: `${c.label}：${c.value}`, emphasize: false });
    if (lines.length === 0) continue;
    const fontSize = Math.max(9, Math.min(16, (r.h - 8) / lines.length - 4, r.w * 0.22));
    const lineH = fontSize + 4;
    const startY = r.y + r.h / 2 - (lineH * (lines.length - 1)) / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((ln, i) => {
      ctx.font = `bold ${fontSize}px ${FONT}`;
      ctx.fillStyle = ln.emphasize ? '#16213e' : '#333';
      ctx.fillText(ln.text, r.x + r.w / 2, startY + i * lineH, r.w - 6);
    });
  }

  // 通路（部屋の上に重ねる）。以下の3種を描き分ける
  //  A. 外部入口（entry != null）: 外側から部屋の該当辺へ矢印
  //  B. 隣接する部屋の間: 境界を跨いで両側の内側に食い込む短いライン
  //  C. 離れた部屋: 中心を直線／L字で結ぶ
  ctx.strokeStyle = 'rgba(25,25,35,0.9)';
  ctx.fillStyle = 'rgba(25,25,35,0.9)';
  ctx.lineWidth = Math.max(2, cell * 0.045);
  for (const link of map.links) {
    if (link.entry) {
      // 外部入口: 部屋の外壁の中央（entry の辺）へ、外から矢印を伸ばす
      const room = roomAt(link.x1, link.y1);
      const rx0 = room ? room.x : link.x1;
      const ry0 = room ? room.y : link.y1;
      const rw = room ? room.w : 1;
      const rh = room ? room.h : 1;
      const roomX = gridX + (rx0 - 1) * cell;
      const roomY = gridY + (ry0 - 1) * cell;
      const rW = rw * cell;
      const rH = rh * cell;
      const stub = cell * 0.32;
      const toX = roomX + rW / 2;
      const toY = roomY + rH / 2;
      let fx = toX;
      let fy = toY;
      let tx = toX;
      let ty = toY;
      if (link.entry === 'up') { fy = roomY - stub; ty = roomY + 4; }
      else if (link.entry === 'down') { fy = roomY + rH + stub; ty = roomY + rH - 4; }
      else if (link.entry === 'left') { fx = roomX - stub; tx = roomX + 4; }
      else { fx = roomX + rW + stub; tx = roomX + rW - 4; }
      arrow(fx, fy, tx, ty);
      continue;
    }
    if (link.x2 === null || link.y2 === null) continue;
    const ra = roomAt(link.x1, link.y1);
    const rb = roomAt(link.x2, link.y2);
    if (ra && rb) {
      const ax = ra.x, ay = ra.y, aw = ra.w, ah = ra.h;
      const bx = rb.x, by = rb.y, bw = rb.w, bh = rb.h;
      const touchH = (ax + aw === bx || bx + bw === ax) && ay < by + bh && by < ay + ah;
      const touchV = (ay + ah === by || by + bh === ay) && ax < bx + bw && bx < ax + aw;
      if (touchH || touchV) {
        // 隣接部屋の通路: 境界を跨いで両側の内側に食い込む短いライン。
        // 部屋の白塗りの上に重ねることで消えないようにする
        const overlapX1 = Math.max(ax, bx);
        const overlapX2 = Math.min(ax + aw, bx + bw);
        const overlapY1 = Math.max(ay, by);
        const overlapY2 = Math.min(ay + ah, by + bh);
        ctx.strokeStyle = 'rgba(30, 32, 42, 0.95)';
        ctx.lineWidth = Math.max(3, cell * 0.06);
        const bite = Math.max(6, cell * 0.18);
        ctx.beginPath();
        if (touchH) {
          const boundary = ax + aw === bx ? ax + aw : bx + bw;
          const bx0 = gridX + (boundary - 1) * cell;
          const gapY = gridY + (overlapY1 - 1) * cell + (overlapY2 - overlapY1) * cell / 2;
          ctx.moveTo(bx0 - bite, gapY);
          ctx.lineTo(bx0 + bite, gapY);
        } else {
          const boundary = ay + ah === by ? ay + ah : by + bh;
          const by0 = gridY + (boundary - 1) * cell;
          const gapX = gridX + (overlapX1 - 1) * cell + (overlapX2 - overlapX1) * cell / 2;
          ctx.moveTo(gapX, by0 - bite);
          ctx.lineTo(gapX, by0 + bite);
        }
        ctx.stroke();
        continue;
      }
    }
    // 離れた部屋どうし: 中心を直線／L字で結ぶ
    const a = centerOf(link.x1, link.y1);
    const b = centerOf(link.x2, link.y2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (link.x1 !== link.x2 && link.y1 !== link.y2) ctx.lineTo(b.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.restore();
  return gridGeometry(gridX, gridY, cell, map.cols, map.rows);
}

/** 領土の所属→CUD推奨配色（色覚多様性対応）。色に加えて枠線でも区別する */
const TERRITORY_STYLE: Record<
  'self' | 'ally' | 'enemy' | 'neutral',
  { color: string; border: string; dash: number[] }
> = {
  self: { color: '#03af7a', border: 'rgba(3,175,122,0.8)', dash: [] },
  ally: { color: '#005aff', border: 'rgba(0,90,255,0.7)', dash: [] },
  enemy: { color: '#ff4b00', border: 'rgba(255,75,0,0.8)', dash: [5, 3] },
  neutral: { color: '#222', border: 'rgba(60,60,70,0.3)', dash: [] },
};

/**
 * 王国周辺図。全マスを白マスで敷き、@terr の領土を所属色（CUD配色）で、
 * @dist の道中マス数を朱色の数字で描く（領土マスには隅に重ね書き）
 */
function drawKingdomMap(
  ctx: CanvasRenderingContext2D,
  map: Extract<MapState, { kind: 'kingdom' }>,
): MapGeometry | null {
  if (map.cols < 1 || map.rows < 1) return null;
  ctx.save();
  const { gridX, gridY, cell } = drawGridPanel(ctx, map.title, map.cols, map.rows);

  const cellRect = (cx: number, cy: number) => ({
    x: gridX + (cx - 1) * cell + 2,
    y: gridY + (cy - 1) * cell + 2,
    w: cell - 4,
    h: cell - 4,
  });

  // 全マスの下地
  ctx.lineWidth = 1;
  for (let cy = 1; cy <= map.rows; cy++) {
    for (let cx = 1; cx <= map.cols; cx++) {
      const r = cellRect(cx, cy);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = 'rgba(60,60,70,0.3)';
      ctx.setLineDash([]);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }

  // 領土（所属色の文字＋枠。色だけに頼らず敵国は破線枠で区別）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const terr of map.terrs) {
    const r = cellRect(terr.x, terr.y);
    const style = TERRITORY_STYLE[terr.side];
    if (terr.side !== 'neutral') {
      ctx.strokeStyle = style.border;
      ctx.lineWidth = 2;
      ctx.setLineDash(style.dash);
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.setLineDash([]);
    }
    const fontSize = Math.max(9, Math.min(14, (r.h - 6) / terr.lines.length - 3, r.w * 0.19));
    const lineH = fontSize + 3;
    const startY = r.y + r.h / 2 - (lineH * (terr.lines.length - 1)) / 2;
    ctx.font = `bold ${fontSize}px ${FONT}`;
    ctx.fillStyle = style.color;
    terr.lines.forEach((ln, i) => {
      ctx.fillText(ln, r.x + r.w / 2, startY + i * lineH, r.w - 6);
    });
  }

  // 道中マス数（イベント表を振る回数）。空きマスは中央に大きく、領土マスは右下隅に
  for (const d of map.dists) {
    const r = cellRect(d.x, d.y);
    const occupied = map.terrs.some((t) => t.x === d.x && t.y === d.y);
    ctx.fillStyle = '#ff4b00';
    if (occupied) {
      ctx.font = `bold ${Math.max(11, cell * 0.3)}px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(d.value), r.x + r.w - 3, r.y + r.h - 1);
    } else {
      ctx.font = `bold ${Math.max(14, cell * 0.42)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(d.value), r.x + r.w / 2, r.y + r.h / 2);
    }
  }

  ctx.restore();
  return gridGeometry(gridX, gridY, cell, map.cols, map.rows);
}

/** ラベルから敵味方を推定する。判定キーワードはゲームテンプレート定義に従う */
function laneSide(label: string, template: GameTemplate): 'ally' | 'enemy' | 'neutral' {
  const kw = template.battlefield?.sideKeywords;
  if (kw?.enemy.some((k) => label.includes(k))) return 'enemy';
  if (kw?.ally.some((k) => label.includes(k))) return 'ally';
  return 'neutral';
}

/**
 * 素材不要の生成戦場マップ。列（レーン）＝縦帯として描画し、
 * 敵味方で色相を分け、状態 danger の列（戦場トラップ発動）は朱色で警告する
 */
function drawLanesMap(
  ctx: CanvasRenderingContext2D,
  map: Extract<MapState, { kind: 'lanes' }>,
  template: GameTemplate,
): MapGeometry | null {
  const n = map.lanes.length;
  if (n === 0) return null;
  const gap = 10;
  const laneW = Math.min(150, (MAP_AREA.w - gap * (n - 1)) / n);
  const totalW = laneW * n + gap * (n - 1);
  const startX = MAP_AREA.x + (MAP_AREA.w - totalW) / 2;
  const laneH = MAP_AREA.h;
  const y = MAP_AREA.y;
  const cellH = laneH / map.rows;

  ctx.save();
  for (let i = 0; i < n; i++) {
    const lane = map.lanes[i];
    const x = startX + i * (laneW + gap);
    const danger = lane.state === 'danger';
    const side = laneSide(lane.label, template);

    // 敵味方で色相を変える（色覚多様性に配慮して青系 vs 暖色系）。
    // トラップ発動(danger)は色＋明度＋枠の太さの複数の手がかりで区別する
    const fill = danger
      ? 'rgba(196, 98, 32, 0.92)'
      : side === 'ally'
        ? 'rgba(86, 118, 156, 0.55)'
        : side === 'enemy'
          ? 'rgba(150, 100, 92, 0.55)'
          : 'rgba(140, 138, 148, 0.5)';

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, laneW, laneH, 8);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = danger ? 'rgba(255, 216, 160, 0.9)' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = danger ? 3.5 : 2;
    ctx.beginPath();
    ctx.roundRect(x, y, laneW, laneH, 8);
    ctx.stroke();

    // マス目（横線＋中央縦線）
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let r = 1; r < map.rows; r++) {
      ctx.beginPath();
      ctx.moveTo(x + 4, y + r * cellH);
      ctx.lineTo(x + laneW - 4, y + r * cellH);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x + laneW / 2, y + 4);
    ctx.lineTo(x + laneW / 2, y + laneH - 4);
    ctx.stroke();

    // 縦書きラベル（透かし風）
    ctx.fillStyle = danger ? 'rgba(255, 240, 218, 0.65)' : 'rgba(255,255,255,0.5)';
    const chars = [...lane.label];
    const fontSize = Math.min(laneW * 0.5, (laneH - 24) / Math.max(chars.length, 1));
    ctx.font = `bold ${fontSize}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textH = fontSize * chars.length;
    chars.forEach((c, ci) => {
      ctx.fillText(c, x + laneW / 2, y + (laneH - textH) / 2 + fontSize * (ci + 0.5));
    });
  }
  ctx.restore();

  // 生成マップの座標は列・行（1始まり、小数でマス内の位置を指定可）
  const toX = (lx: number) => {
    const lane = Math.max(1, Math.min(n, Math.floor(lx)));
    const frac = lx - Math.floor(lx);
    return startX + (lane - 1) * (laneW + gap) + (frac === 0 ? 0.5 : frac) * laneW;
  };
  const toY = (ry: number) => {
    const row = Math.max(1, Math.min(map.rows, Math.floor(ry)));
    const frac = ry - Math.floor(ry);
    return y + (frac === 0 ? row - 0.5 : row - 1 + frac) * cellH;
  };
  return { toX, toY, unit: cellH * 0.82 };
}

function drawChips(
  ctx: CanvasRenderingContext2D,
  cut: Cut,
  map: MapState,
  images: ImageStore,
  characters: Character[],
  template: GameTemplate,
  geo: MapGeometry,
  options: DrawOptions,
): void {
  const charByName = new Map(characters.map((c) => [c.name, c]));
  const t = options.timeInCut ?? Infinity;

  for (const chip of map.chips) {
    const ch = charByName.get(chip.characterName); // 未登録名（その場限りの敵）は undefined のまま描く
    const asset = chip.image ?? ch?.chipImage ?? ch?.faceIcon;
    const chipImg = asset ? findImage(images, asset) : undefined;

    // 滑走移動: from → 現在位置へキャンバス座標で補間（イージング付き）
    let cx = geo.toX(chip.x);
    let cy = geo.toY(chip.y);
    if (chip.from && t < CHIP_MOVE_SECONDS) {
      const p = t / CHIP_MOVE_SECONDS;
      const e = p * p * (3 - 2 * p); // smoothstep
      cx = geo.toX(chip.from.x) + (cx - geo.toX(chip.from.x)) * e;
      cy = geo.toY(chip.from.y) + (cy - geo.toY(chip.from.y)) * e;
    }

    const size = Math.max(24, geo.unit) * (ch?.chipScale ?? 1);
    if (chipImg) {
      const s = size / Math.max(chipImg.width, chipImg.height);
      ctx.drawImage(
        chipImg,
        cx - (chipImg.width * s) / 2,
        cy - (chipImg.height * s) / 2,
        chipImg.width * s,
        chipImg.height * s,
      );
    } else {
      // チップ画像がない場合は名前入りのプレースホルダ。
      // 敵味方はレーンと同じ青系/暖色系の色相ペアで塗り分け、
      // 色覚多様性に配慮して形でも区別する（味方＝丸、敵＝角丸四角）
      const isAlly = !!ch && ch.showInStatusBar;
      ctx.save();
      ctx.fillStyle = isAlly ? 'rgba(58, 106, 186, 0.92)' : 'rgba(178, 80, 46, 0.92)';
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (isAlly) ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      else ctx.roundRect(cx - size / 2, cy - size / 2, size, size, size * 0.18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(11, size * 0.32)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((cut.displayNames[chip.characterName] ?? chip.characterName).slice(0, 2), cx, cy);
      ctx.restore();
    }

    // ステータスバー非表示の登録キャラ（＝敵など）はチップの下にミニHPを表示する
    if (ch && !ch.showInStatusBar) {
      const hp = cut.paramsSnapshot[ch.name]?.[template.damageParamKey];
      if (hp?.kind === 'pair' && hp.max > 0) {
        const barW = Math.max(36, size);
        const barH = 6;
        const bx = cx - barW / 2;
        const by = cy + size / 2 + 4;
        const ratio = Math.max(0, Math.min(1, hp.current / hp.max));
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        ctx.fillStyle = ratio <= 0.25 ? '#ff5d5d' : ratio <= 0.5 ? '#ffc44d' : '#6dff9e';
        ctx.fillRect(bx, by, barW * ratio, barH);
        ctx.font = `bold 12px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(`${hp.current}/${hp.max}`, cx, by + barH + 2);
        ctx.fillStyle = '#fff';
        ctx.fillText(`${hp.current}/${hp.max}`, cx, by + barH + 2);
        ctx.restore();
      }
    }
  }
}

/** 「死」「天」「鴉」等の白札マーカー。複数文字は縦書き */
function drawMarks(ctx: CanvasRenderingContext2D, map: MapState, geo: MapGeometry): void {
  ctx.save();
  for (const mark of map.marks) {
    const cx = geo.toX(mark.x);
    const cy = geo.toY(mark.y);
    const chars = [...mark.text];
    const fontSize = Math.max(16, geo.unit * 0.55);
    const pad = fontSize * 0.18;
    const w = fontSize + pad * 2;
    const h = fontSize * chars.length + pad * 2;

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(cx - w / 2, cy - h / 2, w, h);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#111';
    ctx.font = `bold ${fontSize}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    chars.forEach((c, ci) => {
      ctx.fillText(c, cx, cy - h / 2 + pad + fontSize * (ci + 0.5));
    });
  }
  ctx.restore();
}

// ctx.filter はブラウザ実装差があり将来のOffscreenCanvas書き出しでリスクなので、
// 暗色化はプリミティブ合成（source-atop）で行いキャッシュする
const darkenCache = new WeakMap<HTMLImageElement, HTMLCanvasElement>();

function darkened(img: HTMLImageElement): HTMLCanvasElement {
  const cached = darkenCache.get(img);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const c = canvas.getContext('2d')!;
  c.drawImage(img, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = 'rgba(0, 0, 0, 0.4)';
  c.fillRect(0, 0, canvas.width, canvas.height);
  darkenCache.set(img, canvas);
  return canvas;
}

// ============ ステータスバー ============

function drawStatusBar(
  ctx: CanvasRenderingContext2D,
  cut: Cut,
  images: ImageStore,
  characters: Character[],
  template: GameTemplate,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(12, 14, 26, 0.82)';
  ctx.fillRect(0, 0, CANVAS_W, BAR_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, BAR_H + 0.5);
  ctx.lineTo(CANVAS_W, BAR_H + 0.5);
  ctx.stroke();

  const shown = characters.filter((c) => c.showInStatusBar);
  // 人数が多いときは王国パネルを細くしてキャラセルの幅を確保する
  const globalW = shown.length >= 6 ? 150 : 220;
  const cellW = shown.length > 0 ? (CANVAS_W - globalW) / shown.length : 0;

  shown.forEach((ch, i) => {
    drawCharacterCell(ctx, ch, cut, images, template, i * cellW, cellW);
  });

  drawGlobalPanel(ctx, cut, template, CANVAS_W - globalW, globalW);
  ctx.restore();
}

function drawCharacterCell(
  ctx: CanvasRenderingContext2D,
  ch: Character,
  cut: Cut,
  images: ImageStore,
  template: GameTemplate,
  x: number,
  w: number,
): void {
  // セル幅に合わせてアイコン・文字を縮小する（6人パーティ等でも溢れないように）
  const compact = w < 220;
  const pad = compact ? 8 : 10;
  const textW = compact ? 96 : 130;
  const nameFont = compact ? 14 : 17;
  const paramFont = compact ? 11.5 : 13;
  const rowH = compact ? 19 : 21;
  const firstRowY = pad + (compact ? 21 : 26);
  const valueOffset = compact ? 38 : 44;

  // 顔アイコンはテキストに必要な幅を確保した残りに収める。狭すぎるときは省略
  const iconSize = Math.min(BAR_H - pad * 2, w - textW - pad * 3);
  const showIcon = iconSize >= 36;
  if (showIcon) {
    const icon = ch.faceIcon ? findImage(images, ch.faceIcon) : undefined;
    const iconY = (BAR_H - iconSize) / 2;
    if (icon) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + pad, iconY, iconSize, iconSize, 8);
      ctx.clip();
      // coverフィット後、キャラごとの倍率でズーム（顔だけ大きく見せる等の調整用）
      const scale = Math.max(iconSize / icon.width, iconSize / icon.height) * (ch.faceIconScale ?? 1);
      ctx.drawImage(
        icon,
        x + pad + (iconSize - icon.width * scale) / 2,
        iconY + (iconSize - icon.height * scale) / 2,
        icon.width * scale,
        icon.height * scale,
      );
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.roundRect(x + pad, iconY, iconSize, iconSize, 8);
      ctx.fill();
    }
  }

  const textX = x + pad + (showIcon ? iconSize + pad : 0);
  const textMaxW = x + w - textX - pad;
  // 名前（@name で変更された表示名があればそちら）
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${nameFont}px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText(cut.displayNames[ch.name] ?? ch.name, textX, pad, textMaxW);

  // パラメータ
  const params = cut.paramsSnapshot[ch.name] ?? ch.params;
  ctx.font = `${paramFont}px ${FONT}`;
  let y = firstRowY;
  for (const def of template.characterParams) {
    const v = params[def.key];
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(def.label, textX, y, valueOffset - 4);
    ctx.fillStyle = paramColor(def.key, v, template);
    ctx.fillText(formatParam(v), textX + valueOffset, y, textMaxW - valueOffset);
    y += rowH;
    if (y > BAR_H - rowH + 4) break;
  }
}

function drawGlobalPanel(
  ctx: CanvasRenderingContext2D,
  cut: Cut,
  template: GameTemplate,
  x: number,
  w: number,
): void {
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x, 0, w, BAR_H);

  const compact = w < 180;
  const font = compact ? 11.5 : 13;
  const valueX = compact ? 84 : 100;
  ctx.font = `${font}px ${FONT}`;
  ctx.textBaseline = 'top';
  let y = 10;
  for (const def of template.globalParams) {
    const v = cut.globalSnapshot[def.key];
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(def.label, x + 12, y, valueX - 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(formatParam(v), x + valueX, y, w - valueX - 10);
    y += 22;
    if (y > BAR_H - 16) break;
  }
}

function paramColor(key: string, v: ParamValue | undefined, template: GameTemplate): string {
  if (key === template.damageParamKey && v?.kind === 'pair') {
    const ratio = v.max > 0 ? v.current / v.max : 0;
    if (ratio <= 0.25) return '#ff5d5d';
    if (ratio <= 0.5) return '#ffc44d';
  }
  return '#fff';
}

function formatParam(v: ParamValue | undefined): string {
  if (!v) return '-';
  switch (v.kind) {
    case 'pair':
      return `${v.current}/${v.max}`;
    case 'number':
      return String(v.value);
    case 'text':
      return v.value;
  }
}

// ============ メッセージウィンドウ ============

function drawMessageWindow(
  ctx: CanvasRenderingContext2D,
  message: { speaker: string; text: string },
  scale = 1,
): void {
  const margin = 24;
  const h = 170;
  const x = margin;
  const y = CANVAS_H - h - margin;
  const w = CANVAS_W - margin * 2;

  ctx.save();
  ctx.fillStyle = 'rgba(16, 18, 32, 0.88)';
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.stroke();

  // 話者名プレート
  ctx.font = `bold 20px ${FONT}`;
  const nameW = ctx.measureText(message.speaker).width + 36;
  ctx.fillStyle = 'rgba(88, 101, 242, 0.92)';
  ctx.beginPath();
  ctx.roundRect(x + 20, y - 18, nameW, 36, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(message.speaker, x + 38, y);

  // 本文（自動折り返し。あふれた分は「…」で切ってウィンドウ外への描画を防ぐ）
  // @fontsize の倍率でサムネ用の巨大文字にも対応。行数はウィンドウに収まる範囲で自動計算
  const fontSize = 22 * scale;
  const lineHeight = fontSize * 1.55;
  const maxLines = Math.max(1, Math.floor((h - 40) / lineHeight));
  ctx.font = `${scale > 1.4 ? 'bold ' : ''}${fontSize}px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#f2f3f7';
  if (scale > 1.4) {
    // 巨大文字は縁取りで視認性を上げる（サムネ映え）
    ctx.lineWidth = fontSize * 0.12;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    wrapText(ctx, message.text, x + 30, y + 36, w - 60, lineHeight, maxLines, true);
  }
  wrapText(ctx, message.text, x + 30, y + 36, w - 60, lineHeight, maxLines);
  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
  stroke = false,
): void {
  const lines: string[] = [];
  let line = '';
  for (const chch of text) {
    if (ctx.measureText(line + chch).width > maxWidth) {
      lines.push(line);
      line = chch;
    } else {
      line += chch;
    }
  }
  if (line) lines.push(line);

  const clipped = lines.length > maxLines;
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const isLast = i === maxLines - 1;
    const t = clipped && isLast ? lines[i].slice(0, -1) + '…' : lines[i];
    if (stroke) ctx.strokeText(t, x, y + i * lineHeight);
    else ctx.fillText(t, x, y + i * lineHeight);
  }
}

// ============ 演出 ============

function drawDamagePopup(ctx: CanvasRenderingContext2D, popup: DamagePopup): void {
  // 同じ増減量ごとにまとめて1行にする（範囲攻撃で名前を並べる）
  const groups = new Map<number, string[]>();
  for (const e of popup.entries) {
    const names = groups.get(e.delta) ?? [];
    names.push(e.characterName);
    groups.set(e.delta, names);
  }
  const rows = [...groups.entries()];
  const multi = rows.length > 1;
  const bigFont = multi ? 64 : 96;
  const subFont = multi ? 24 : 30;
  const rowH = bigFont + subFont + 40;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = CANVAS_W / 2;
  const startY = CANVAS_H / 2 - 40 - ((rows.length - 1) * rowH) / 2;

  rows.forEach(([delta, names], i) => {
    const cy = startY + i * rowH;
    const up = delta > 0;
    const label = popup.paramLabel
      ? `${popup.paramLabel} ${up ? '+' : ''}${delta}`
      : `${up ? '+' : ''}${delta}`;
    const sub = popup.paramLabel
      ? `${names.join('・')} の${popup.paramLabel}が${up ? '上昇' : '低下'}`
      : `${names.join('・')} ${up ? 'は回復した！' : 'に ダメージ！'}`;

    ctx.font = `bold ${bigFont}px ${FONT}`;
    ctx.lineWidth = bigFont * 0.1;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(label, cx, cy);
    ctx.fillStyle = up ? '#6dff9e' : '#ff5d5d';
    ctx.fillText(label, cx, cy);

    ctx.font = `bold ${subFont}px ${FONT}`;
    ctx.lineWidth = subFont * 0.2;
    ctx.strokeText(sub, cx, cy + bigFont * 0.55 + subFont * 0.7, CANVAS_W - 120);
    ctx.fillStyle = '#fff';
    ctx.fillText(sub, cx, cy + bigFont * 0.55 + subFont * 0.7, CANVAS_W - 120);
  });
  ctx.restore();
}

/**
 * ダイス素材の解決。フォルダなら中の画像をファイル名順で返し（連番アニメ）、
 * 画像1枚の指定ならそれだけを返す（転がしアニメなしの静止ダイス）
 */
export function diceFrames(images: ImageStore, ref: string | undefined): HTMLImageElement[] {
  if (!ref) return [];
  const single = findImage(images, ref);
  if (single) return [single];
  const keys = [...images.keys()].filter((k) => k.startsWith(ref + '/')).sort();
  return keys.map((k) => images.get(k)!);
}

function drawDice(
  ctx: CanvasRenderingContext2D,
  dice: DiceEffect,
  images: ImageStore,
  characters: Character[],
  options: DrawOptions,
): void {
  const ch = dice.characterName
    ? characters.find((c) => c.name === dice.characterName)
    : undefined;
  const folder = ch?.diceFolder ?? options.defaultDiceFolder;
  const frames = diceFrames(images, folder);

  const t = options.timeInCut ?? Infinity;
  // フレームが1枚だけ（単品画像ダイス）のときは転がさず静止表示
  const animate = (options.diceAnimation ?? true) && frames.length > 1;
  const rolling = animate && t < DICE_ROLL_SECONDS;

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2 - 40;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // ダイス数（2d6 → 2個。表示は最大4個まで）
  const count = Math.min(4, Math.max(1, Number(dice.spec.match(/^(\d*)[dD]/)?.[1] || 1)));
  const size = 130;
  const gap = 20;
  const totalW = count * size + (count - 1) * gap;

  if (frames.length > 0) {
    for (let i = 0; i < count; i++) {
      // 各ダイスはフレーム位相をずらして「バラバラに転がっている」ように見せる。
      // 時間からの決定的な計算なので書き出し時も同じ絵になる
      const frame = rolling
        ? frames[(Math.floor(t / DICE_FRAME_SECONDS) + i * 7) % frames.length]
        : frames[(i * 7 + 3) % frames.length];
      const x = cx - totalW / 2 + i * (size + gap);
      const bounce = rolling ? -Math.abs(Math.sin((t * 6 + i) * Math.PI)) * 24 : 0;
      const scale = size / Math.max(frame.width, frame.height);
      const w = frame.width * scale;
      const h = frame.height * scale;
      ctx.drawImage(frame, x + (size - w) / 2, cy - size / 2 + (size - h) / 2 + bounce, w, h);
    }
  }

  // 出目（転がり終わったら表示。素材がない場合は従来の角丸ダイス）
  if (!rolling) {
    if (frames.length === 0) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(cx - 75, cy - 75, 150, 150, 24);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#16213e';
      ctx.font = `bold 64px ${FONT}`;
      ctx.fillText(dice.result, cx, cy + 4);
    } else {
      ctx.font = `bold 84px ${FONT}`;
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(dice.result, cx, cy + size / 2 + 70);
      ctx.fillStyle = '#ffd94d';
      ctx.fillText(dice.result, cx, cy + size / 2 + 70);
    }
  }

  ctx.font = `bold 26px ${FONT}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(dice.spec, cx, cy - size / 2 - 40);
  ctx.fillStyle = '#fff';
  ctx.fillText(dice.spec, cx, cy - size / 2 - 40);
  ctx.restore();
}
