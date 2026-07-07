import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import type { Character, ParamValue } from './types';
import { getTemplate } from './templates/mazeKingdom';
import { parseScript } from './script/parser';
import { buildCuts } from './script/player';
import { useAssets } from './hooks/useAssets';
import { exportMp4 } from './export/mp4';
import { PreviewPane } from './components/PreviewPane';
import { AssetPanel } from './components/AssetPanel';
import { AssetSelect } from './components/AssetSelect';
import { CharacterPanel } from './components/CharacterPanel';
import { SAMPLE_SCRIPT } from './sampleScript';

const STORAGE_KEY = 'kamishibai-project-v1';

interface StoredProject {
  script: string;
  characters: Character[];
  /** ゲームテンプレートID（現状は maze-kingdom のみ。将来のテンプレート追加用） */
  templateId?: string;
  /** ダイスの連番アニメを再生するか（既定 true） */
  diceAnimation?: boolean;
  /** キャラにダイスセット未設定のときに使う素材フォルダ */
  defaultDiceFolder?: string;
  /** 動画キャンバスのフォント（未指定は同梱のBIZ UDPゴシック） */
  fontFamily?: string;
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
      assetFolders: Array.isArray(c.assetFolders)
        ? c.assetFolders.filter((f): f is string => typeof f === 'string')
        : undefined,
      aliases: Array.isArray(c.aliases)
        ? c.aliases.filter((a): a is string => typeof a === 'string')
        : undefined,
    }));
  return {
    script: d.script,
    characters,
    templateId: typeof d.templateId === 'string' ? d.templateId : undefined,
    diceAnimation: d.diceAnimation !== false,
    defaultDiceFolder: typeof d.defaultDiceFolder === 'string' ? d.defaultDiceFolder : undefined,
    fontFamily: typeof d.fontFamily === 'string' ? d.fontFamily : undefined,
  };
}

/** 動画キャンバス用フォントの選択肢（既定は同梱のUDフォント） */
const FONT_CHOICES: { value: string; label: string }[] = [
  { value: '', label: 'BIZ UDPゴシック（UD・既定）' },
  { value: 'Hiragino Sans', label: 'ヒラギノ角ゴシック' },
  { value: 'Hiragino Mincho ProN', label: 'ヒラギノ明朝' },
  { value: 'YuGothic', label: '游ゴシック' },
  { value: 'sans-serif', label: 'システム標準' },
];

/** プロジェクトファイル（.kamishibai.json）の形式 */
interface ProjectFile extends StoredProject {
  format: 'kamishibai-project';
  version: 1;
}

export default function App() {
  const stored = useMemo(loadStored, []);
  const [templateId, setTemplateId] = useState(stored?.templateId ?? 'maze-kingdom');
  const template = getTemplate(templateId);
  const [script, setScript] = useState(stored?.script ?? SAMPLE_SCRIPT);
  const [characters, setCharacters] = useState<Character[]>(stored?.characters ?? []);
  const [diceAnimation, setDiceAnimation] = useState(stored?.diceAnimation !== false);
  const [defaultDiceFolder, setDefaultDiceFolder] = useState<string | undefined>(
    stored?.defaultDiceFolder,
  );
  const [fontFamily, setFontFamily] = useState<string | undefined>(stored?.fontFamily);
  const { assets, imageStore, restoring, addFiles, addDropped, removeAsset, removeFolder, removeAll } =
    useAssets();
  const imageAssets = useMemo(
    () => [...assets.values()].filter((a) => a.kind === 'image'),
    [assets],
  );

  // 脚本とキャラ設定は localStorage に自動保存（素材はM2でIndexedDB対応予定）
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ script, characters, templateId, diceAnimation, defaultDiceFolder, fontFamily }),
        );
      } catch {
        // quota超過などで保存できなくても編集は続行できる（ファイル書き出しは可能）
      }
    }, 500);
    return () => clearTimeout(t);
  }, [script, characters, templateId, diceAnimation, defaultDiceFolder, fontFamily]);

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
  /** null = 非書き出し中、0-1 = 進捗 */
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  const exportVideo = async () => {
    if (exportProgress !== null) return;
    setExportProgress(0);
    try {
      const blob = await exportMp4({
        cuts,
        characters,
        template,
        images: imageStore,
        assets,
        defaultDiceFolder,
        diceAnimation,
        fontFamily,
        onProgress: setExportProgress,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kamishibai.mp4';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`動画の書き出しに失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExportProgress(null);
    }
  };

  const exportProject = () => {
    const file: ProjectFile = {
      format: 'kamishibai-project',
      version: 1,
      script,
      characters,
      templateId,
      diceAnimation,
      defaultDiceFolder,
      fontFamily,
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
      setTemplateId(project.templateId ?? 'maze-kingdom');
      setDiceAnimation(project.diceAnimation !== false);
      setDefaultDiceFolder(project.defaultDiceFolder);
      setFontFamily(project.fontFamily);
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
          <select
            value={fontFamily ?? ''}
            onChange={(e) => setFontFamily(e.target.value || undefined)}
            title="動画のフォント（既定はユニバーサルデザインのBIZ UDPゴシック）"
          >
            {FONT_CHOICES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <label className="inline-checkbox" title="OFFにするとダイスは転がらず出目だけ表示します">
            <input
              type="checkbox"
              checked={diceAnimation}
              onChange={(e) => setDiceAnimation(e.target.checked)}
            />
            ダイスアニメ
          </label>
          <AssetSelect
            imageAssets={imageAssets}
            value={defaultDiceFolder}
            onChange={setDefaultDiceFolder}
            allowFolder
            placeholder="既定ダイス（内蔵）"
          />
          <button
            className="export-button"
            onClick={exportVideo}
            disabled={exportProgress !== null || cuts.length === 0}
            title="脚本全体をmp4動画として書き出します（BGM/SE込み）"
          >
            {exportProgress === null
              ? '🎬 動画書き出し'
              : `書き出し中… ${Math.round(exportProgress * 100)}%`}
          </button>
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
            fontFamily={fontFamily}
          />
          <div className="bottom-panels">
            <CharacterPanel
              characters={characters}
              template={template}
              assets={assets}
              onChange={setCharacters}
            />
            <AssetPanel
              assets={assets}
              restoring={restoring}
              onAddFiles={addFiles}
              onAddDropped={addDropped}
              onRemove={removeAsset}
              onRemoveFolder={removeFolder}
              onRemoveAll={removeAll}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
