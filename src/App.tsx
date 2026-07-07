import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import type { Character, ParamValue } from './types';
import { getTemplate } from './templates/mazeKingdom';
import { parseScript } from './script/parser';
import { buildCuts } from './script/player';
import { useAssets } from './hooks/useAssets';
import { PreviewPane } from './components/PreviewPane';
import { AssetPanel } from './components/AssetPanel';
import { CharacterPanel } from './components/CharacterPanel';
import { SAMPLE_SCRIPT } from './sampleScript';

const STORAGE_KEY = 'kamishibai-project-v1';

interface StoredProject {
  script: string;
  characters: Character[];
  /** ダイスの連番アニメを再生するか（既定 true） */
  diceAnimation?: boolean;
  /** キャラにダイスセット未設定のときに使う素材フォルダ */
  defaultDiceFolder?: string;
}

function loadStored(): StoredProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * 外部から来たプロジェクトデータ（localStorage / インポートファイル）の形状を検証・補完する。
 * スキーマが古い・壊れているデータで画面全体がクラッシュするのを防ぐ。
 */
function normalizeProject(data: unknown): StoredProject | null {
  const d = data as Partial<StoredProject> | null;
  if (!d || typeof d.script !== 'string' || !Array.isArray(d.characters)) return null;
  const characters: Character[] = d.characters
    .filter((c): c is Character => !!c && typeof c === 'object' && typeof (c as Character).name === 'string')
    .map((c) => ({
      id: typeof c.id === 'string' ? c.id : crypto.randomUUID(),
      name: c.name,
      portraits: c.portraits && typeof c.portraits === 'object' ? c.portraits : {},
      defaultExpression: typeof c.defaultExpression === 'string' ? c.defaultExpression : 'default',
      faceIcon: typeof c.faceIcon === 'string' ? c.faceIcon : undefined,
      params: c.params && typeof c.params === 'object' ? c.params : {},
      showInStatusBar: c.showInStatusBar !== false,
      portraitScale: typeof c.portraitScale === 'number' ? c.portraitScale : undefined,
      portraitOffsetY: typeof c.portraitOffsetY === 'number' ? c.portraitOffsetY : undefined,
      diceFolder: typeof c.diceFolder === 'string' ? c.diceFolder : undefined,
      faceIconScale: typeof c.faceIconScale === 'number' ? c.faceIconScale : undefined,
      chipImage: typeof c.chipImage === 'string' ? c.chipImage : undefined,
      chipScale: typeof c.chipScale === 'number' ? c.chipScale : undefined,
      flipOnRight: c.flipOnRight === true,
    }));
  return {
    script: d.script,
    characters,
    diceAnimation: d.diceAnimation !== false,
    defaultDiceFolder: typeof d.defaultDiceFolder === 'string' ? d.defaultDiceFolder : undefined,
  };
}

/** プロジェクトファイル（.kamishibai.json）の形式 */
interface ProjectFile extends StoredProject {
  format: 'kamishibai-project';
  version: 1;
}

export default function App() {
  const template = getTemplate('maze-kingdom');
  const stored = useMemo(loadStored, []);
  const [script, setScript] = useState(stored?.script ?? SAMPLE_SCRIPT);
  const [characters, setCharacters] = useState<Character[]>(stored?.characters ?? []);
  const [diceAnimation, setDiceAnimation] = useState(stored?.diceAnimation !== false);
  const [defaultDiceFolder, setDefaultDiceFolder] = useState<string | undefined>(
    stored?.defaultDiceFolder,
  );
  const { assets, imageStore, imageFolders, addFiles, addDropped, removeAsset, removeFolder } =
    useAssets();

  // 脚本とキャラ設定は localStorage に自動保存（素材はM2でIndexedDB対応予定）
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ script, characters, diceAnimation, defaultDiceFolder }),
        );
      } catch {
        // quota超過などで保存できなくても編集は続行できる（ファイル書き出しは可能）
      }
    }, 500);
    return () => clearTimeout(t);
  }, [script, characters, diceAnimation, defaultDiceFolder]);

  const globalParams = useMemo(() => {
    const params: Record<string, ParamValue> = {};
    for (const def of template.globalParams) {
      params[def.key] =
        def.kind === 'pair'
          ? { kind: 'pair', current: def.defaultValue ?? 0, max: def.defaultValue ?? 0 }
          : def.kind === 'number'
            ? { kind: 'number', value: def.defaultValue ?? 0 }
            : { kind: 'text', value: def.defaultText ?? '' };
    }
    return params;
  }, [template]);

  const importInputRef = useRef<HTMLInputElement>(null);

  const exportProject = () => {
    const file: ProjectFile = {
      format: 'kamishibai-project',
      version: 1,
      script,
      characters,
      diceAnimation,
      defaultDiceFolder,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project.kamishibai.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProject = async (file: File) => {
    try {
      const data: unknown = JSON.parse(await file.text());
      const project =
        (data as Partial<ProjectFile>)?.format === 'kamishibai-project' ? normalizeProject(data) : null;
      if (!project) {
        alert('kamishibaiのプロジェクトファイルではありません');
        return;
      }
      setScript(project.script);
      setCharacters(project.characters);
      setDiceAnimation(project.diceAnimation !== false);
      setDefaultDiceFolder(project.defaultDiceFolder);
    } catch {
      alert('プロジェクトファイルを読み込めませんでした');
    }
  };

  const { commands, errors } = useMemo(() => parseScript(script), [script]);
  const { cuts, warnings } = useMemo(
    () => buildCuts(commands, characters, template, globalParams),
    [commands, characters, template, globalParams],
  );
  const problems = useMemo(
    () => [...errors.map((e) => ({ ...e, level: 'error' as const })), ...warnings.map((w) => ({ ...w, level: 'warning' as const }))].sort((a, b) => a.line - b.line),
    [errors, warnings],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>kamishibai</h1>
        <span className="subtitle">TRPGリプレイ動画クリエイター — {template.name}</span>
        <div className="header-actions">
          <label className="inline-checkbox" title="OFFにするとダイスは転がらず出目だけ表示します">
            <input
              type="checkbox"
              checked={diceAnimation}
              onChange={(e) => setDiceAnimation(e.target.checked)}
            />
            ダイスアニメ
          </label>
          <select
            value={defaultDiceFolder ?? ''}
            onChange={(e) => setDefaultDiceFolder(e.target.value || undefined)}
            title="キャラにダイスセット未設定のときに使う素材フォルダ"
          >
            <option value="">既定ダイス（内蔵）</option>
            {imageFolders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button onClick={exportProject}>保存（書き出し）</button>
          <button onClick={() => importInputRef.current?.click()}>開く（読み込み）</button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importProject(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>
      <main className="app-main">
        <div className="left-column">
          <section className="panel script-panel">
            <h2>脚本</h2>
            <textarea
              className="script-editor"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              spellCheck={false}
            />
            {problems.length > 0 && (
              <ul className="error-list">
                {problems.map((p, i) => (
                  <li key={i} className={p.level === 'warning' ? 'problem-warning' : undefined}>
                    {p.line}行目: {p.message}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="right-column">
          <PreviewPane
            cuts={cuts}
            characters={characters}
            template={template}
            images={imageStore}
            assets={assets}
            defaultDiceFolder={defaultDiceFolder}
            diceAnimation={diceAnimation}
          />
          <div className="bottom-panels">
            <CharacterPanel
              characters={characters}
              template={template}
              assets={assets}
              imageFolders={imageFolders}
              onChange={setCharacters}
            />
            <AssetPanel
              assets={assets}
              onAddFiles={addFiles}
              onAddDropped={addDropped}
              onRemove={removeAsset}
              onRemoveFolder={removeFolder}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
