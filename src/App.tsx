import { useEffect, useMemo, useState } from 'react';
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
}

function loadStored(): StoredProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredProject) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const template = getTemplate('maze-kingdom');
  const stored = useMemo(loadStored, []);
  const [script, setScript] = useState(stored?.script ?? SAMPLE_SCRIPT);
  const [characters, setCharacters] = useState<Character[]>(stored?.characters ?? []);
  const { assets, imageStore, addFiles, removeAsset } = useAssets();

  // 脚本とキャラ設定は localStorage に自動保存（素材はM2でIndexedDB対応予定）
  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ script, characters }));
    }, 500);
    return () => clearTimeout(t);
  }, [script, characters]);

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

  const { commands, errors } = useMemo(() => parseScript(script), [script]);
  const cuts = useMemo(
    () => buildCuts(commands, characters, template, globalParams),
    [commands, characters, template, globalParams],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>kamishibai</h1>
        <span className="subtitle">TRPGリプレイ動画クリエイター — {template.name}</span>
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
            {errors.length > 0 && (
              <ul className="error-list">
                {errors.map((e, i) => (
                  <li key={i}>
                    {e.line}行目: {e.message}
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
          />
          <div className="bottom-panels">
            <CharacterPanel
              characters={characters}
              template={template}
              assets={assets}
              onChange={setCharacters}
            />
            <AssetPanel assets={assets} onAddFiles={addFiles} onRemove={removeAsset} />
          </div>
        </div>
      </main>
    </div>
  );
}
