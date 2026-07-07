import type { GameTemplate } from '../types';

/** 迷宮キングダム用テンプレート */
export const mazeKingdomTemplate: GameTemplate = {
  id: 'maze-kingdom',
  name: '迷宮キングダム',
  characterParams: [
    { key: 'hp', label: 'ＨＰ', kind: 'pair', defaultValue: 10 },
    { key: 'mp', label: '気力', kind: 'pair', defaultValue: 3 },
    { key: 'minion', label: '配下', kind: 'pair', defaultValue: 1 },
    { key: 'state', label: '状態', kind: 'text', defaultText: '正常' },
  ],
  globalParams: [
    { key: 'voice', label: '民の声', kind: 'pair', defaultValue: 10 },
    { key: 'turn', label: 'ターン', kind: 'number', defaultValue: 1 },
    { key: 'quarter', label: 'クォーター', kind: 'number', defaultValue: 1 },
    { key: 'meal', label: '食事', kind: 'number', defaultValue: 0 },
    { key: 'production', label: '生産力', kind: 'number', defaultValue: 0 },
  ],
  damageParamKey: 'hp',
};

export const templates: GameTemplate[] = [mazeKingdomTemplate];

export function getTemplate(id: string): GameTemplate {
  return templates.find((t) => t.id === id) ?? mazeKingdomTemplate;
}
