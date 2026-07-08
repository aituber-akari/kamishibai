import { useState } from 'react';
import type { Character, GameTemplate, ParamValue } from '../types';
import type { Asset } from '../hooks/useAssets';
import { AssetSelect } from './AssetSelect';

interface Props {
  characters: Character[];
  template: GameTemplate;
  assets: Map<string, Asset>;
  onChange: (characters: Character[]) => void;
}

export function defaultParams(template: GameTemplate): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  for (const def of template.characterParams) {
    if (def.kind === 'pair') {
      params[def.key] = { kind: 'pair', current: def.defaultValue ?? 0, max: def.defaultValue ?? 0 };
    } else if (def.kind === 'number') {
      params[def.key] = { kind: 'number', value: def.defaultValue ?? 0 };
    } else {
      params[def.key] = { kind: 'text', value: def.defaultText ?? '' };
    }
  }
  return params;
}

export function CharacterPanel({ characters, template, assets, onChange }: Props) {
  const [newName, setNewName] = useState('');
  const imageAssets = [...assets.values()].filter((a) => a.kind === 'image');

  const update = (id: string, patch: Partial<Character>) => {
    onChange(characters.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const addCharacter = () => {
    const name = newName.trim();
    if (!name || characters.some((c) => c.name === name)) return;
    onChange([
      ...characters,
      {
        id: crypto.randomUUID(),
        name,
        portraits: {},
        defaultExpression: 'default',
        params: defaultParams(template),
        showInStatusBar: true,
      },
    ]);
    setNewName('');
  };

  return (
    <section className="panel">
      <h2>キャラクター</h2>
      <div className="add-character">
        <input
          value={newName}
          placeholder="キャラクター名"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCharacter()}
        />
        <button onClick={addCharacter} disabled={!newName.trim()}>
          追加
        </button>
      </div>
      <div className="character-list">
        {characters.map((ch) => (
          <CharacterCard
            key={ch.id}
            ch={ch}
            template={template}
            imageAssets={imageAssets}
            onUpdate={(patch) => update(ch.id, patch)}
            onRemove={() => onChange(characters.filter((c) => c.id !== ch.id))}
          />
        ))}
        {characters.length === 0 && (
          <p className="empty-note">キャラクターを追加すると、セリフに応じて立ち絵とステータスが自動で組まれます</p>
        )}
      </div>
    </section>
  );
}

function topFolder(name: string): string {
  const idx = name.indexOf('/');
  return idx < 0 ? '' : name.slice(0, idx);
}

function CharacterCard({
  ch,
  template,
  imageAssets,
  onUpdate,
  onRemove,
}: {
  ch: Character;
  template: GameTemplate;
  imageAssets: Asset[];
  onUpdate: (patch: Partial<Character>) => void;
  onRemove: () => void;
}) {
  const [newExpression, setNewExpression] = useState('');

  // キャラに素材フォルダを紐づけると、このカード内の選択候補が絞られる
  const linked = ch.assetFolders ?? [];
  const allTopFolders = [...new Set(imageAssets.map((a) => topFolder(a.name)).filter(Boolean))].sort();
  const scopedAssets =
    linked.length > 0
      ? imageAssets.filter((a) => linked.some((f) => a.name === f || a.name.startsWith(f + '/')))
      : imageAssets;

  const setPortrait = (expression: string, assetName: string | undefined) => {
    const portraits = { ...ch.portraits };
    if (assetName) portraits[expression] = assetName;
    else delete portraits[expression];
    onUpdate({ portraits });
  };

  const setParam = (key: string, value: ParamValue) => {
    onUpdate({ params: { ...ch.params, [key]: value } });
  };

  const expressions = Object.keys(ch.portraits);
  if (!expressions.includes(ch.defaultExpression)) expressions.unshift(ch.defaultExpression);

  return (
    <details className="character-card">
      <summary>
        <strong>{ch.name}</strong>
        <label className="inline-checkbox" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={ch.showInStatusBar}
            onChange={(e) => onUpdate({ showInStatusBar: e.target.checked })}
          />
          ステータスバー表示
        </label>
        <button className="icon-button" onClick={onRemove} title="削除">
          ✕
        </button>
      </summary>

      <div className="row">
        <span className="row-label">別名</span>
        <input
          value={(ch.aliases ?? []).join('、')}
          placeholder="例: PL1、PL名（読点・カンマ区切り）"
          title="脚本中でこの名前を使っても同じキャラとして扱われます（PL名・変名など）。話者プレートには書いた名前が表示されます"
          onChange={(e) =>
            onUpdate({
              aliases: e.target.value
                .split(/[、,]/)
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </div>

      <h3>素材フォルダの紐づけ</h3>
      <div className="row">
        <select
          value=""
          onChange={(e) => {
            if (e.target.value && !linked.includes(e.target.value)) {
              onUpdate({ assetFolders: [...linked, e.target.value] });
            }
          }}
          title="紐づけると、このキャラの素材選択候補がフォルダ内に絞られます"
        >
          <option value="">＋ フォルダを紐づける（未紐づけ＝全素材から選択）</option>
          {allTopFolders
            .filter((f) => !linked.includes(f))
            .map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
        </select>
      </div>
      {linked.length > 0 && (
        <div className="row folder-tags">
          {linked.map((f) => (
            <span key={f} className="folder-tag">
              📁 {f}
              <button
                className="icon-button"
                onClick={() => onUpdate({ assetFolders: linked.filter((x) => x !== f) })}
                title="紐づけ解除"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <h3>立ち絵（表情差分）</h3>
      {expressions.map((exp) => (
        <div key={exp} className="row">
          <span className="row-label">{exp}</span>
          <AssetSelect
            imageAssets={scopedAssets}
            value={ch.portraits[exp]}
            onChange={(v) => setPortrait(exp, v)}
          />
        </div>
      ))}
      <div className="row">
        <input
          value={newExpression}
          placeholder="表情名を追加（例: 笑顔）→ Enter"
          onChange={(e) => setNewExpression(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newExpression.trim()) {
              setPortrait(newExpression.trim(), scopedAssets[0]?.name);
              setNewExpression('');
            }
          }}
        />
      </div>

      <div className="row">
        <span className="row-label">顔アイコン</span>
        <AssetSelect
          imageAssets={scopedAssets}
          value={ch.faceIcon}
          onChange={(v) => onUpdate({ faceIcon: v })}
        />
        <span className="row-label">倍率</span>
        <input
          type="number"
          step={0.1}
          min={0.2}
          max={5}
          value={ch.faceIconScale ?? 1}
          onChange={(e) => onUpdate({ faceIconScale: Number(e.target.value) || 1 })}
        />
      </div>
      <div className="row">
        <span className="row-label">マップチップ</span>
        <AssetSelect
          imageAssets={scopedAssets}
          value={ch.chipImage}
          onChange={(v) => onUpdate({ chipImage: v })}
          placeholder="（顔アイコンを使用）"
        />
        <span className="row-label">倍率</span>
        <input
          type="number"
          step={0.1}
          min={0.2}
          max={5}
          value={ch.chipScale ?? 1}
          onChange={(e) => onUpdate({ chipScale: Number(e.target.value) || 1 })}
        />
      </div>

      <h3>表示調整</h3>
      <div className="row">
        <label className="inline-checkbox">
          <input
            type="checkbox"
            checked={ch.flipOnRight ?? false}
            onChange={(e) => onUpdate({ flipOnRight: e.target.checked })}
          />
          右側配置で左右反転（向かい合わせ用）
        </label>
      </div>
      <div className="row">
        <span className="row-label">立ち絵倍率</span>
        <input
          type="number"
          step={0.05}
          min={0.1}
          max={3}
          value={ch.portraitScale ?? 1}
          onChange={(e) => onUpdate({ portraitScale: Number(e.target.value) || 1 })}
        />
        <span className="row-label">縦位置(px)</span>
        <input
          type="number"
          step={10}
          value={ch.portraitOffsetY ?? 0}
          onChange={(e) => onUpdate({ portraitOffsetY: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="row">
        <span className="row-label">ダイス</span>
        <AssetSelect
          imageAssets={scopedAssets}
          value={ch.diceFolder}
          onChange={(v) => onUpdate({ diceFolder: v })}
          allowFolder
          placeholder="（プロジェクト既定）"
        />
      </div>

      <h3>パラメータ初期値</h3>
      {template.characterParams.map((def) => {
        const v = ch.params[def.key];
        return (
          <div key={def.key} className="row">
            <span className="row-label">{def.label}</span>
            {v?.kind === 'pair' && (
              <>
                <input
                  type="number"
                  value={v.current}
                  onChange={(e) => setParam(def.key, { ...v, current: Number(e.target.value) })}
                />
                <span>/</span>
                <input
                  type="number"
                  value={v.max}
                  onChange={(e) => setParam(def.key, { ...v, max: Number(e.target.value) })}
                />
              </>
            )}
            {v?.kind === 'number' && (
              <input
                type="number"
                value={v.value}
                onChange={(e) => setParam(def.key, { kind: 'number', value: Number(e.target.value) })}
              />
            )}
            {v?.kind === 'text' && (
              <input
                value={v.value}
                onChange={(e) => setParam(def.key, { kind: 'text', value: e.target.value })}
              />
            )}
          </div>
        );
      })}
    </details>
  );
}
