import type { Character, Cut, GameTemplate, ParamValue } from '../types';

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

/** アセット名（ファイル名）→ 読み込み済み画像 */
export type ImageStore = Map<string, HTMLImageElement>;

const FONT = '"Hiragino Sans", "Noto Sans JP", sans-serif';

/**
 * 1カットを Canvas に描画する純関数。
 * プレビューも mp4 書き出しも必ずこの関数を通す（見た目のズレを防ぐ）。
 */
export function drawCut(
  ctx: CanvasRenderingContext2D,
  cut: Cut,
  images: ImageStore,
  characters: Character[],
  template: GameTemplate,
): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  drawBackground(ctx, cut, images);
  drawPortraits(ctx, cut, images, characters);
  if (cut.statusVisible) drawStatusBar(ctx, cut, images, characters, template);
  if (cut.dice) drawDice(ctx, cut.dice);
  if (cut.damagePopup) drawDamagePopup(ctx, cut.damagePopup);
  if (cut.message) drawMessageWindow(ctx, cut.message);
}

function drawBackground(ctx: CanvasRenderingContext2D, cut: Cut, images: ImageStore): void {
  const img = cut.bg ? images.get(cut.bg) : undefined;
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
  const isSpeaking = (name: string) => cut.message?.speaker === name;

  for (const p of cut.portraits) {
    const ch = charByName.get(p.characterName);
    if (!ch) continue;
    const assetName = ch.portraits[p.expression] ?? ch.portraits[ch.defaultExpression];
    const img = assetName ? images.get(assetName) : undefined;
    if (!img) continue;

    // 高さ基準でスケール（画面の 72% の高さに収める）
    const h = CANVAS_H * 0.72;
    const w = (img.width / img.height) * h;
    const y = CANVAS_H - h - 60; // メッセージウィンドウの上端付近まで
    const x =
      p.position === 'left' ? 40 : p.position === 'right' ? CANVAS_W - w - 40 : (CANVAS_W - w) / 2;

    // 発言中でないキャラは少し暗く
    ctx.save();
    if (cut.message && !isSpeaking(p.characterName)) ctx.filter = 'brightness(0.6)';
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }
}

// ============ ステータスバー ============

const BAR_H = 132;

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
  const globalW = 220;
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
  const pad = 10;
  // 顔アイコン
  const iconSize = BAR_H - pad * 2;
  const icon = ch.faceIcon ? images.get(ch.faceIcon) : undefined;
  if (icon) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + pad, pad, iconSize, iconSize, 8);
    ctx.clip();
    const scale = Math.max(iconSize / icon.width, iconSize / icon.height);
    ctx.drawImage(
      icon,
      x + pad + (iconSize - icon.width * scale) / 2,
      pad + (iconSize - icon.height * scale) / 2,
      icon.width * scale,
      icon.height * scale,
    );
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(x + pad, pad, iconSize, iconSize, 8);
    ctx.fill();
  }

  const textX = x + pad + iconSize + 10;
  // 名前
  ctx.fillStyle = '#fff';
  ctx.font = `bold 17px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText(ch.name, textX, pad, w - iconSize - pad * 3);

  // パラメータ
  const params = cut.paramsSnapshot[ch.name] ?? ch.params;
  ctx.font = `13px ${FONT}`;
  let y = pad + 26;
  for (const def of template.characterParams) {
    const v = params[def.key];
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(def.label, textX, y);
    ctx.fillStyle = paramColor(def.key, v, template);
    ctx.fillText(formatParam(v), textX + 44, y);
    y += 21;
    if (y > BAR_H - 16) break;
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

  ctx.font = `13px ${FONT}`;
  ctx.textBaseline = 'top';
  let y = 10;
  for (const def of template.globalParams) {
    const v = cut.globalSnapshot[def.key];
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(def.label, x + 14, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(formatParam(v), x + 100, y);
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

  // 本文（自動折り返し）
  ctx.font = `22px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#f2f3f7';
  wrapText(ctx, message.text, x + 30, y + 36, w - 60, 34);
  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  let line = '';
  let cy = y;
  for (const chch of text) {
    if (ctx.measureText(line + chch).width > maxWidth) {
      ctx.fillText(line, x, cy);
      line = chch;
      cy += lineHeight;
    } else {
      line += chch;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

// ============ 演出 ============

function drawDamagePopup(
  ctx: CanvasRenderingContext2D,
  popup: { characterName: string; amount: number },
): void {
  const isHeal = popup.amount < 0;
  const label = isHeal ? `+${-popup.amount}` : `-${popup.amount}`;
  const sub = isHeal ? '回復！' : 'ダメージ！';

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2 - 40;

  ctx.font = `bold 96px ${FONT}`;
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(label, cx, cy);
  ctx.fillStyle = isHeal ? '#6dff9e' : '#ff5d5d';
  ctx.fillText(label, cx, cy);

  ctx.font = `bold 30px ${FONT}`;
  ctx.lineWidth = 6;
  ctx.strokeText(`${popup.characterName} に ${sub}`, cx, cy + 78);
  ctx.fillStyle = '#fff';
  ctx.fillText(`${popup.characterName} に ${sub}`, cx, cy + 78);
  ctx.restore();
}

function drawDice(ctx: CanvasRenderingContext2D, dice: { spec: string; result: string }): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2 - 40;

  // ダイス風の角丸四角
  const size = 150;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(cx - size / 2, cy - size / 2, size, size, 24);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#16213e';
  ctx.font = `bold 64px ${FONT}`;
  ctx.fillText(dice.result, cx, cy + 4);

  ctx.font = `bold 26px ${FONT}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(dice.spec, cx, cy - size / 2 - 30);
  ctx.fillStyle = '#fff';
  ctx.fillText(dice.spec, cx, cy - size / 2 - 30);
  ctx.restore();
}
