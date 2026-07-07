import { useCallback, useRef, useState } from 'react';

export interface Asset {
  name: string;
  kind: 'image' | 'audio' | 'other';
  url: string;
  image?: HTMLImageElement;
}

function kindOf(file: File): Asset['kind'] {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'other';
}

/**
 * PC上の素材ファイル（立ち絵・背景・BGM・SE）をブラウザに読み込んで管理する。
 * 現状はメモリ保持（M2でIndexedDB永続化予定）。脚本からはファイル名で参照する。
 */
export function useAssets() {
  const [assets, setAssets] = useState<Map<string, Asset>>(new Map());
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const loaded: Asset[] = await Promise.all(
      Array.from(files).map(async (file) => {
        const url = URL.createObjectURL(file);
        const asset: Asset = { name: file.name, kind: kindOf(file), url };
        if (asset.kind === 'image') {
          asset.image = await loadImage(url);
        }
        return asset;
      }),
    );
    setAssets((prev) => {
      const next = new Map(prev);
      for (const a of loaded) {
        const old = next.get(a.name);
        if (old) URL.revokeObjectURL(old.url);
        next.set(a.name, a);
      }
      return next;
    });
    return loaded;
  }, []);

  const removeAsset = useCallback((name: string) => {
    setAssets((prev) => {
      const next = new Map(prev);
      const old = next.get(name);
      if (old) URL.revokeObjectURL(old.url);
      next.delete(name);
      return next;
    });
  }, []);

  /** 描画用: 画像アセットだけの Map を作る */
  const imageStore = new Map<string, HTMLImageElement>();
  for (const [name, a] of assets) {
    if (a.image) imageStore.set(name, a.image);
  }

  return { assets, imageStore, addFiles, removeAsset };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
