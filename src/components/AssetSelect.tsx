import { useEffect, useMemo, useState } from 'react';
import type { Asset } from '../hooks/useAssets';

/** ファイル選択で「フォルダ全体」を表す内部値 */
const FOLDER_VALUE = '__folder__';

interface Props {
  imageAssets: Asset[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /** true でフォルダ自体を選択可能にする（ダイスの連番アニメ用） */
  allowFolder?: boolean;
  /** 未設定オプションのラベル */
  placeholder?: string;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? '' : path.slice(0, idx);
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

/**
 * 素材の2段選択（フォルダ → ファイル）。
 * 素材が数百枚あっても、まずフォルダで絞ってから選べる
 */
export function AssetSelect({ imageAssets, value, onChange, allowFolder, placeholder }: Props) {
  const byFolder = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of imageAssets) {
      const dir = dirname(a.name);
      const list = map.get(dir) ?? [];
      list.push(a);
      map.set(dir, list);
    }
    for (const list of map.values()) list.sort((x, y) => x.name.localeCompare(y.name));
    return map;
  }, [imageAssets]);

  const folders = useMemo(() => [...byFolder.keys()].sort(), [byFolder]);
  const assetNames = useMemo(() => new Set(imageAssets.map((a) => a.name)), [imageAssets]);

  // 現在値からフォルダを導出（値はファイルパスか、allowFolder時はフォルダそのもの）
  const deriveFolder = (v: string | undefined) =>
    v === undefined ? '' : assetNames.has(v) ? dirname(v) : v;

  const [folder, setFolder] = useState(() => deriveFolder(value));
  useEffect(() => {
    if (value !== undefined) setFolder(deriveFolder(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const files = byFolder.get(folder) ?? [];
  const fileValue = value === undefined ? '' : assetNames.has(value) ? value : FOLDER_VALUE;

  return (
    <span className="asset-select">
      <select
        value={folder}
        onChange={(e) => {
          const f = e.target.value;
          setFolder(f);
          if (allowFolder && f) onChange(f);
          else onChange(byFolder.get(f)?.[0]?.name);
        }}
        title="素材フォルダ"
      >
        {!folders.includes(folder) && <option value={folder}>（フォルダを選択）</option>}
        {folders.map((f) => (
          <option key={f} value={f}>
            {f === '' ? '（ルート）' : f}
          </option>
        ))}
      </select>
      <select
        value={fileValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') onChange(undefined);
          else if (v === FOLDER_VALUE) onChange(folder);
          else onChange(v);
        }}
        title="素材ファイル"
      >
        <option value="">{placeholder ?? '（未設定）'}</option>
        {allowFolder && folder && <option value={FOLDER_VALUE}>（フォルダ全体＝連番アニメ）</option>}
        {files.map((a) => (
          <option key={a.name} value={a.name}>
            {basename(a.name)}
          </option>
        ))}
      </select>
    </span>
  );
}
