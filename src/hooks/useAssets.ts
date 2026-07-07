import { useCallback, useMemo, useState } from 'react';

export interface Asset {
  /** フォルダ構造を保った相対パス（例: dice/red/dice_01.png）。これが登録キー */
  name: string;
  kind: 'image' | 'audio' | 'other';
  url: string;
  image?: HTMLImageElement;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac)$/i;
const IGNORE_FILES = /^(Thumbs\.db|\.DS_Store|desktop\.ini)$/i;

function kindOf(file: File): Asset['kind'] {
  if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) return 'image';
  if (file.type.startsWith('audio/') || AUDIO_EXT.test(file.name)) return 'audio';
  return 'other';
}

/** ドロップ/選択されたファイルの登録キー（相対パス）を決める */
function assetKey(file: File, overridePath?: string): string {
  const rel = overridePath ?? (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return (rel && rel.length > 0 ? rel : file.name).replace(/^\/+/, '');
}

interface NamedFile {
  file: File;
  path: string;
}

/** DataTransferItem からフォルダを再帰的に読む（ドラッグ&ドロップ用） */
async function collectFromEntry(entry: FileSystemEntry, out: NamedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    if (!IGNORE_FILES.test(file.name)) out.push({ file, path: entry.fullPath.replace(/^\/+/, '') });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries は一度に全部返さないことがあるので空になるまで読む
    for (;;) {
      const entries = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (entries.length === 0) break;
      for (const e of entries) await collectFromEntry(e, out);
    }
  }
}

/**
 * PC上の素材ファイル（立ち絵・ダイス・背景・BGM・SE）をブラウザに読み込んで管理する。
 * フォルダごとの一括登録に対応し、フォルダ構造は相対パスとしてキーに保持する。
 * 現状はメモリ保持（M2でIndexedDB永続化予定）。
 */
export function useAssets() {
  const [assets, setAssets] = useState<Map<string, Asset>>(new Map());

  const registerFiles = useCallback(async (files: NamedFile[]) => {
    // 1ファイルの読み込み失敗（壊れた画像など）が他のファイルを巻き込まないよう
    // allSettled で成功分だけ登録する
    const results = await Promise.allSettled(files.map(({ file, path }) => loadAsset(file, path)));
    const loaded: Asset[] = [];
    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') loaded.push(r.value);
      else failed.push(files[i]?.path ?? '(不明なファイル)');
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
      const head = failed.slice(0, 10).join('\n');
      alert(`読み込めなかったファイルがあります (${failed.length}件):\n${head}${failed.length > 10 ? '\n…' : ''}`);
    }
    return loaded;
  }, []);

  /** input[type=file]（webkitdirectory含む）からの登録 */
  const addFiles = useCallback(
    (files: FileList | File[]) =>
      registerFiles(
        Array.from(files)
          .filter((f) => !IGNORE_FILES.test(f.name))
          .map((f) => ({ file: f, path: assetKey(f) })),
      ),
    [registerFiles],
  );

  /** ドラッグ&ドロップからの登録（フォルダ対応） */
  const addDropped = useCallback(
    async (dt: DataTransfer) => {
      const out: NamedFile[] = [];
      const entries = Array.from(dt.items)
        .map((item) => item.webkitGetAsEntry?.())
        .filter((e): e is FileSystemEntry => !!e);
      if (entries.length > 0) {
        for (const e of entries) await collectFromEntry(e, out);
      } else {
        for (const f of Array.from(dt.files)) {
          if (!IGNORE_FILES.test(f.name)) out.push({ file: f, path: f.name });
        }
      }
      return registerFiles(out);
    },
    [registerFiles],
  );

  const removeAsset = useCallback((name: string) => {
    setAssets((prev) => {
      const next = new Map(prev);
      const old = next.get(name);
      if (old) URL.revokeObjectURL(old.url);
      next.delete(name);
      return next;
    });
  }, []);

  /** フォルダ（プレフィックス）単位の一括削除 */
  const removeFolder = useCallback((folder: string) => {
    setAssets((prev) => {
      const next = new Map(prev);
      for (const [name, a] of prev) {
        if (name.startsWith(folder + '/')) {
          URL.revokeObjectURL(a.url);
          next.delete(name);
        }
      }
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

  /** 画像を含むフォルダ一覧（ダイスセット選択などに使う） */
  const imageFolders = useMemo(() => {
    const folders = new Set<string>();
    for (const [name, a] of assets) {
      if (!a.image) continue;
      const idx = name.lastIndexOf('/');
      if (idx > 0) folders.add(name.slice(0, idx));
    }
    return [...folders].sort();
  }, [assets]);

  return { assets, imageStore, imageFolders, addFiles, addDropped, removeAsset, removeFolder };
}

async function loadAsset(file: File, path: string): Promise<Asset> {
  const url = URL.createObjectURL(file);
  const asset: Asset = { name: path, kind: kindOf(file), url };
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
