import { useState } from 'react';
import type { Character, GameTemplate, ParamValue } from '../types';
import type { Asset } from '../hooks/useAssets';

interface Props {
  characters: Character[];
  template: GameTemplate;
  assets: Map<string, Asset>;
  /** 画像を含むフォルダ一覧（ダイスセット選択用） */
  imageFolders: string[];
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

export function CharacterPanel({ characters, template, assets, imageFolders, onChange }: Props) {
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
            imageFolders={imageFolders}
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

function CharacterCard({
  ch,
  template,
  imageAssets,
  imageFolders,
  onUpdate,
  onRemove,
}: {
  ch: Character;
  template: GameTemplate;
  imageAssets: Asset[];
  imageFolders: string[];
  onUpdate: (patch: Partial<Character>) => void;
  onRemove: () => void;
}) {
  const [newExpression, setNewExpression] = useState('');

  const setPortrait = (expression: string, assetName: string) => {
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

      <h3>立ち絵（表情差分）</h3>
      {expressions.map((exp) => (
        <div key={exp} className="row">
          <span className="row-label">{exp}</span>
          <select value={ch.portraits[exp] ?? ''} onChange={(e) => setPortrait(exp, e.target.value)}>
            <option value="">（未設定）</option>
            {imageAssets.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="row">
        <input
          value={newExpression}
          placeholder="表情名を追加（例: 笑顔）"
          onChange={(e) => setNewExpression(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newExpression.trim()) {
              setPortrait(newExpression.trim(), imageAssets[0]?.name ?? '');
              setNewExpression('');
            }
          }}
        />
      </div>

      <div className="row">
        <span className="row-label">顔アイコン</span>
        <select value={ch.faceIcon ?? ''} onChange={(e) => onUpdate({ faceIcon: e.target.value || undefined })}>
          <option value="">（未設定）</option>
          {imageAssets.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
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
        <select
          value={ch.chipImage ?? ''}
          onChange={(e) => onUpdate({ chipImage: e.target.value || undefined })}
          title="@chip でマップに置く画像。未設定なら顔アイコンを使います"
        >
          <option value="">（顔アイコンを使用）</option>
          {imageAssets.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
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
        <span className="row-label">ダイスセット</span>
        <select
          value={ch.diceFolder ?? ''}
          onChange={(e) => onUpdate({ diceFolder: e.target.value || undefined })}
        >
          <option value="">（プロジェクト既定）</option>
          {imageFolders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
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
