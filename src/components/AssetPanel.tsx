import { useRef, useState } from 'react';
import type { Asset } from '../hooks/useAssets';

interface Props {
  assets: Map<string, Asset>;
  onAddFiles: (files: FileList | File[]) => void;
  onRemove: (name: string) => void;
}

const KIND_ICON: Record<Asset['kind'], string> = { image: '🖼️', audio: '🎵', other: '📄' };

export function AssetPanel({ assets, onAddFiles, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <section className="panel">
      <h2>素材ライブラリ</h2>
      <div
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onAddFiles(e.dataTransfer.files);
        }}
      >
        画像・音声ファイルをドロップ、またはクリックして選択
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,audio/*"
          hidden
          onChange={(e) => {
            if (e.target.files) onAddFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <ul className="asset-list">
        {[...assets.values()].map((a) => (
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
