import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import {
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { setDiagnostics, lintGutter } from '@codemirror/lint';
import { tags } from '@lezer/highlight';

export interface ScriptProblem {
  line: number;
  message: string;
  level: 'error' | 'warning';
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  problems: ScriptProblem[];
  /** 補完候補: キャラ名（別名込み） */
  characterNames: string[];
  /** 補完候補: 素材名（相対パス） */
  assetNames: string[];
  /** カーソル行が変わったとき（1始まり）。プレビュー同期に使う */
  onCursorLine?: (line: number) => void;
}

export interface ScriptEditorHandle {
  /** エラーリストのクリック等から指定行へジャンプする */
  jumpToLine: (line: number) => void;
}

/** コマンド名と補完に出す説明（先頭の一致で絞り込まれる） */
const COMMANDS: [string, string][] = [
  ['bg', '背景を変える'],
  ['bgm', 'BGM開始/停止（stop, 音量, fade）'],
  ['se', '効果音'],
  ['show', '立ち絵を表示'],
  ['hide', '立ち絵を消す'],
  ['damage', 'HPを減らす（複数人可）'],
  ['heal', '回復（複数人可）'],
  ['mod', 'HP以外のパラメータ増減'],
  ['set', 'キャラのパラメータ変更'],
  ['setglobal', '全体パラメータ変更'],
  ['dice', 'ダイス演出'],
  ['map', '画像マップ表示'],
  ['bf', '生成戦場マップ'],
  ['dungeon', '生成ダンジョンマップ'],
  ['room', '部屋の開示・カウンタ更新'],
  ['link', '部屋間の通路／外部入口'],
  ['kingdom', '王国周辺図'],
  ['terr', '領土（自国/味方/敵）'],
  ['dist', '道中マス数'],
  ['lane', '戦場の列の状態変更'],
  ['trap', '戦場トラップ'],
  ['chip', 'マップにコマを置く/動かす'],
  ['mark', '白札マーカー'],
  ['name', '表示名を変更'],
  ['status', 'ステータスバー表示切替'],
  ['wait', 'カットの表示秒数'],
  ['fadeout', '暗転（色指定可）'],
  ['fadein', '明転（色指定可）'],
  ['still', '一枚絵の全画面表示'],
  ['text', 'テキスト画面（〜@end）'],
  ['fontsize', 'メッセージ文字の倍率'],
  ['def', 'マクロ定義（〜@end）'],
  ['call', 'マクロ呼び出し'],
  ['end', 'ブロックの終わり'],
];

/** 引数にキャラ名を補完するコマンド */
const CHAR_ARG = new Set(['show', 'hide', 'damage', 'heal', 'set', 'dice', 'chip', 'name', 'mod']);
/** 引数に素材名を補完するコマンド */
const ASSET_ARG = new Set(['bg', 'bgm', 'se', 'map', 'still']);

/** 脚本のシンタックスハイライト（行単位の簡易トークナイザ） */
const scriptLanguage = StreamLanguage.define<{ commandLine: boolean }>({
  startState: () => ({ commandLine: false }),
  token(stream, state) {
    if (stream.sol()) state.commandLine = false;
    if (stream.sol() && stream.match(/^\s*[#＃]/)) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.sol() && stream.match(/^[@＠][a-zA-Z]+/)) {
      state.commandLine = true;
      return 'keyword';
    }
    // コマンド行の行中コメント
    if (state.commandLine && stream.match(/\s[#＃].*$/)) return 'comment';
    if (stream.match(/[$＄][1-9]/)) return 'variableName';
    // セリフ行の話者部分（行頭〜コロン）
    if (stream.sol() && stream.match(/^[^:：()（）\s@＠#＃][^:：()（）]*(?:[（(][^)）]*[)）])?\s*[:：]/)) {
      return 'atom';
    }
    stream.next();
    return null;
  },
});

const scriptHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#82aaff', fontWeight: 'bold' },
  { tag: tags.comment, color: '#6a7285', fontStyle: 'italic' },
  { tag: tags.atom, color: '#c3e88d', fontWeight: 'bold' },
  { tag: tags.variableName, color: '#ffcb6b', fontWeight: 'bold' },
]);

/** アプリのダークテーマに合わせたエディタ配色 */
const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      fontSize: '13px',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: "'SF Mono', Menlo, Consolas, monospace",
      lineHeight: '1.8',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: '#fff' },
    '.cm-cursor': { borderLeftColor: '#fff' },
    '.cm-gutters': {
      backgroundColor: 'rgba(255,255,255,0.03)',
      color: '#5a6078',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.07)', color: '#aab' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(88,101,242,0.35) !important',
    },
    '.cm-tooltip': {
      backgroundColor: '#232538',
      color: '#e8e8f0',
      border: '1px solid rgba(255,255,255,0.15)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'rgba(88,101,242,0.5)',
    },
  },
  { dark: true },
);

export const ScriptEditor = forwardRef<ScriptEditorHandle, Props>(function ScriptEditor(
  { value, onChange, problems, characterNames, assetNames, onCursorLine },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // 補完ソースやリスナーから常に最新値を読むための ref
  const charNamesRef = useRef(characterNames);
  const assetNamesRef = useRef(assetNames);
  const onChangeRef = useRef(onChange);
  const onCursorLineRef = useRef(onCursorLine);
  charNamesRef.current = characterNames;
  assetNamesRef.current = assetNames;
  onChangeRef.current = onChange;
  onCursorLineRef.current = onCursorLine;
  const lastCursorLine = useRef(0);

  useImperativeHandle(ref, () => ({
    jumpToLine(line: number) {
      const view = viewRef.current;
      if (!view) return;
      const n = Math.max(1, Math.min(view.state.doc.lines, line));
      const pos = view.state.doc.line(n).from;
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      view.focus();
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    const completionSource = (context: CompletionContext): CompletionResult | null => {
      const line = context.state.doc.lineAt(context.pos);
      const before = line.text.slice(0, context.pos - line.from);

      // 「@」直後: コマンド名
      const cmdMatch = before.match(/^([@＠])([a-zA-Z]*)$/);
      if (cmdMatch) {
        return {
          from: line.from + 1,
          options: COMMANDS.map(([name, detail]) => ({ label: name, detail, type: 'keyword' })),
          validFor: /^[a-zA-Z]*$/,
        };
      }

      // コマンドの引数
      const argMatch = before.match(/^[@＠]([a-zA-Z]+)\s+(\S*)$/);
      if (argMatch) {
        const cmd = argMatch[1];
        const from = context.pos - argMatch[2].length;
        if (cmd === 'call') {
          const macros = [...context.state.doc.toString().matchAll(/^[@＠]def\s+(\S+)/gm)].map((m) => m[1]);
          if (macros.length === 0) return null;
          return { from, options: macros.map((m) => ({ label: m, type: 'function' })), validFor: /^\S*$/ };
        }
        if (ASSET_ARG.has(cmd)) {
          return {
            from,
            options: assetNamesRef.current.map((a) => ({ label: a, type: 'text' })),
            validFor: /^\S*$/,
          };
        }
        if (CHAR_ARG.has(cmd)) {
          return {
            from,
            options: charNamesRef.current.map((c) => ({ label: c, type: 'variable' })),
            validFor: /^\S*$/,
          };
        }
        return null;
      }

      // 行頭: 話者名（明示補完のみ。タイプ中の暴発を避けるため2文字以上で発動）
      const speakerMatch = before.match(/^(\S+)$/);
      if (speakerMatch && (context.explicit || speakerMatch[1].length >= 2)) {
        const names = charNamesRef.current.filter((c) => c.startsWith(speakerMatch[1]));
        if (names.length === 0) return null;
        return {
          from: line.from,
          options: names.map((c) => ({ label: c, apply: `${c}: `, type: 'variable' })),
          validFor: /^\S*$/,
        };
      }
      return null;
    };

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          EditorView.lineWrapping,
          scriptLanguage,
          syntaxHighlighting(scriptHighlight),
          autocompletion({ override: [completionSource] }),
          lintGutter(),
          editorTheme,
          keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              const cursorLine = update.state.doc.lineAt(update.state.selection.main.head).number;
              if (cursorLine !== lastCursorLine.current) {
                lastCursorLine.current = cursorLine;
                onCursorLineRef.current?.(cursorLine);
              }
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 初期化は一度だけ。value の外部変更は下の effect で同期する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部からの脚本差し替え（プロジェクト読み込み等）を反映
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // パース結果のエラー・警告をエディタ内の下線＋ガター表示に反映
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const diagnostics = problems
      .filter((p) => p.line >= 1 && p.line <= view.state.doc.lines)
      .map((p) => {
        const line = view.state.doc.line(p.line);
        return {
          from: line.from,
          to: line.to,
          severity: p.level,
          message: p.message,
        };
      });
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [problems]);

  return <div ref={containerRef} className="script-editor-cm" />;
});
