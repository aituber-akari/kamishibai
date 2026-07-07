import { useCallback, useMemo, useState } from 'react';

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

  const addFiles = useCallback(async (files: FileList | File[]) => {
    // 1ファイルの読み込み失敗（壊れた画像など）が他のファイルを巻き込まないよう
    // allSettled で成功分だけ登録する
    const results = await Promise.allSettled(Array.from(files).map(loadAsset));
    const loaded: Asset[] = [];
    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') loaded.push(r.value);
      else failed.push(files[i]?.name ?? '(不明なファイル)');
    });

    setAssets((prev) => {
      const next = new Map(prev);
      for (const a of loaded) {
        const old = next.get(a.name);
        if (old) URL.revokeObjectURL(old.url);
        next.set(a.name, a);
      }
      return next;
    });
    if (failed.length > 0) {
      alert(`読み込めなかったファイルがあります:\n${failed.join('\n')}`);
    }
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

  /** 描画用: 画像アセットだけの Map */
  const imageStore = useMemo(() => {
    const store = new Map<string, HTMLImageElement>();
    for (const [name, a] of assets) {
      if (a.image) store.set(name, a.image);
    }
    return store;
  }, [assets]);

  return { assets, imageStore, addFiles, removeAsset };
}

async function loadAsset(file: File): Promise<Asset> {
  const url = URL.createObjectURL(file);
  const asset: Asset = { name: file.name, kind: kindOf(file), url };
  if (asset.kind === 'image') {
    try {
      asset.image = await loadImage(url);
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }
  return asset;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
