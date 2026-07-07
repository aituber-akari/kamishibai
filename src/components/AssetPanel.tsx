import { useMemo, useRef, useState } from 'react';
import type { Asset } from '../hooks/useAssets';

interface Props {
  assets: Map<string, Asset>;
  onAddFiles: (files: FileList | File[]) => void;
  onAddDropped: (dt: DataTransfer) => void;
  onRemove: (name: string) => void;
  onRemoveFolder: (folder: string) => void;
}

const KIND_ICON: Record<Asset['kind'], string> = { image: '🖼️', audio: '🎵', other: '📄' };

interface FolderGroup {
  folder: string;
  count: number;
  thumb?: Asset;
}

export function AssetPanel({ assets, onAddFiles, onAddDropped, onRemove, onRemoveFolder }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // トップレベルフォルダごとにまとめて表示（数百枚の連番素材でリストが溢れないように）
  const { folders, rootFiles } = useMemo(() => {
    const groups = new Map<string, FolderGroup>();
    const rootFiles: Asset[] = [];
    for (const a of assets.values()) {
      const idx = a.name.indexOf('/');
      if (idx < 0) {
        rootFiles.push(a);
        continue;
      }
      const top = a.name.slice(0, idx);
      const g = groups.get(top) ?? { folder: top, count: 0 };
      g.count++;
      if (!g.thumb && a.kind === 'image') g.thumb = a;
      groups.set(top, g);
    }
    return { folders: [...groups.values()].sort((x, y) => x.folder.localeCompare(y.folder)), rootFiles };
  }, [assets]);

  return (
    <section className="panel">
      <h2>素材ライブラリ</h2>
      <div
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onAddDropped(e.dataTransfer);
        }}
      >
        ファイルやフォルダをここにドロップ
        <div className="drop-zone-buttons">
          <button onClick={() => fileInputRef.current?.click()}>ファイルを選択</button>
          <button onClick={() => folderInputRef.current?.click()}>フォルダを選択</button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,audio/*"
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onAddFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error 標準外だが全主要ブラウザ対応のフォルダ選択属性
          webkitdirectory=""
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onAddFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <ul className="asset-list">
        {folders.map((g) => (
          <li key={g.folder}>
            {g.thumb ? (
              <img src={g.thumb.url} alt={g.folder} className="asset-thumb" />
            ) : (
              <span className="asset-thumb asset-thumb-icon">📁</span>
            )}
            <span className="asset-name" title={g.folder}>
              📁 {g.folder} <span className="asset-count">({g.count})</span>
            </span>
            <button className="icon-button" onClick={() => onRemoveFolder(g.folder)} title="フォルダごと削除">
              ✕
            </button>
          </li>
        ))}
        {rootFiles.map((a) => (
          <li key={a.name}>
            {a.kind === 'image' ? (
              <img src={a.url} alt={a.name} className="asset-thumb" />
            ) : (
              <span className="asset-thumb asset-thumb-icon">{KIND_ICON[a.kind]}</span>
            )}
            <span className="asset-name" title={a.name}>
              {a.name}
            </span>
            <button className="icon-button" onClick={() => onRemove(a.name)} title="削除">
              ✕
            </button>
          </li>
        ))}
        {assets.size === 0 && <li className="empty-note">まだ素材がありません</li>}
      </ul>
    </section>
  );
}
