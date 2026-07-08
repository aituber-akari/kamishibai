/**
 * 脚本の指定カットをNodeで実描画してPNGに書き出す検証スクリプト。
 * ブラウザ無しで drawCut の見た目を確認するために使う（同梱UDフォントで描画）。
 *
 * 使い方: npx vite-node scripts/render-cut.ts -- <脚本ファイル> <カット番号(1始まり)> <出力.png>
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseScript } from '../src/script/parser';
import { buildCuts } from '../src/script/player';
import { drawCut } from '../src/renderer/draw';
import { mazeKingdomTemplate } from '../src/templates/mazeKingdom';

GlobalFonts.registerFromPath('public/fonts/BIZUDPGothic-Regular.ttf', 'BIZ UDPGothic');
GlobalFonts.registerFromPath('public/fonts/BIZUDPGothic-Bold.ttf', 'BIZ UDPGothic');

const [scriptPath, cutNoRaw, outPath] = process.argv.slice(2).filter((a) => a !== '--');
if (!scriptPath || !outPath) {
  console.error('usage: npx vite-node scripts/render-cut.ts -- <脚本.txt> <カット番号> <出力.png>');
  process.exit(1);
}

const source = readFileSync(scriptPath, 'utf-8');
const { commands, errors } = parseScript(source);
if (errors.length > 0) {
  for (const e of errors) console.error(`${e.line}行目: ${e.message}`);
  process.exit(1);
}
const { cuts, warnings } = buildCuts(commands, [], mazeKingdomTemplate, {});
for (const w of warnings) console.warn(`警告 ${w.line}行目: ${w.message}`);

const index = Math.min(cuts.length, Math.max(1, Number(cutNoRaw) || cuts.length)) - 1;
const cut = cuts[index];
if (!cut) {
  console.error('カットがありません');
  process.exit(1);
}

const canvas = createCanvas(1280, 720);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
drawCut(ctx, cut, new Map(), [], mazeKingdomTemplate, {});
writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(`${outPath} にカット ${index + 1}/${cuts.length} を書き出しました`);
