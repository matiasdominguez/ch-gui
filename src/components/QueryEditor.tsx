import Editor, { loader, type OnMount } from "@monaco-editor/react";
import { useComputedColorScheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { format as formatSql } from "sql-formatter";

import { notifyError } from "../lib/notify";
import { statementAtOffset } from "../lib/sqlSplit";
import { closedTabModels, TAB_MODEL_SCHEME } from "../lib/tabModels";
import { useTabs } from "../state/tabs";
import { editorOptions, editorThemes } from "../theme";

for (const t of Object.values(editorThemes)) {
  monaco.editor.defineTheme(t.name, t.data);
}

// Use the bundled Monaco. @monaco-editor/react otherwise fetches it from a CDN.
self.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  },
};
loader.config({ monaco });

interface Props {
  tabId: string;
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  onRunAll: () => void;
  onRunTargetChange?: (sql: string) => void;
  onServerFormat?: (sql: string) => Promise<string>;
  onEscape?: () => void;
}

export interface QueryEditorHandle {
  focus: () => void;
  formatAll: () => void;
  insertAtCursor: (text: string) => void;
  getSqlToRun: () => string | null;
}

export const QueryEditor = forwardRef<QueryEditorHandle, Props>(
  function QueryEditor(
    {
      tabId,
      value,
      onChange,
      onRun,
      onRunAll,
      onRunTargetChange,
      onServerFormat,
      onEscape,
    },
    ref,
  ) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const onRunRef = useRef(onRun);
    onRunRef.current = onRun;
    const onRunAllRef = useRef(onRunAll);
    onRunAllRef.current = onRunAll;
    const onRunTargetChangeRef = useRef(onRunTargetChange);
    onRunTargetChangeRef.current = onRunTargetChange;
    const onServerFormatRef = useRef(onServerFormat);
    onServerFormatRef.current = onServerFormat;
    const onEscapeRef = useRef(onEscape);
    onEscapeRef.current = onEscape;

    useImperativeHandle(ref, () => ({
      focus() {
        editorRef.current?.focus();
      },
      formatAll() {
        const editor = editorRef.current;
        if (!editor) return;
        const pos = editor.getPosition();
        if (pos)
          editor.setSelection(
            new monaco.Selection(
              pos.lineNumber,
              pos.column,
              pos.lineNumber,
              pos.column,
            ),
          );
        formatBuffer(editor, onServerFormatRef.current);
      },
      insertAtCursor(text: string) {
        const editor = editorRef.current;
        if (!editor) return;
        const pos = editor.getPosition();
        if (!pos) return;
        const range = new monaco.Range(
          pos.lineNumber,
          pos.column,
          pos.lineNumber,
          pos.column,
        );
        editor.executeEdits("chgui.palette", [
          { range, text, forceMoveMarkers: true },
        ]);
        editor.focus();
      },
      getSqlToRun() {
        const editor = editorRef.current;
        if (!editor) return null;
        return currentRunTarget(editor).sql || null;
      },
    }));

    useEffect(() => {
      loader.init();
    }, []);

    // Use the resolved scheme, since "auto" must follow macOS. Read it on the
    // first render, or every editor flashes dark on mount, because Monaco
    // themes are global.
    const colorScheme = useComputedColorScheme("dark", {
      getInitialValueInEffect: false,
    });
    const monacoTheme = editorThemes[colorScheme].name;
    useEffect(() => {
      monaco.editor.setTheme(monacoTheme);
    }, [monacoTheme]);

    const openTabIds = useTabs((s) => s.tabs.map((t) => t.id).join(","));
    useEffect(() => {
      const open = openTabIds.split(",");
      for (const model of closedTabModels(monaco.editor.getModels(), open)) {
        model.dispose();
      }
    }, [openTabIds]);

    const handleMount: OnMount = (editor) => {
      editorRef.current = editor;
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
        onRunRef.current(),
      );
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        () => onRunAllRef.current(),
      );

      const activeStmt = editor.createDecorationsCollection();
      let lastTarget: string | null = null;
      const syncRunTarget = () => {
        const { sql, range } = currentRunTarget(editor);
        if (range) {
          activeStmt.set([
            { range, options: { className: "chgui-active-statement" } },
          ]);
        } else {
          activeStmt.clear();
        }
        if (sql !== lastTarget) {
          lastTarget = sql;
          onRunTargetChangeRef.current?.(sql);
        }
      };
      editor.onDidChangeCursorSelection(syncRunTarget);
      editor.onDidChangeModelContent(syncRunTarget);
      editor.onDidChangeModel(syncRunTarget);
      syncRunTarget();

      // Replaces Monaco's default Select All Occurrences binding.
      const formatAction = () =>
        formatBuffer(editor, onServerFormatRef.current);
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL,
        formatAction,
      );
      editor.addAction({
        id: "chgui.format-sql",
        label: "Format SQL (ClickHouse)",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL,
        ],
        contextMenuGroupId: "modification",
        contextMenuOrder: 1,
        run: formatAction,
      });

      editor.addCommand(
        monaco.KeyCode.Escape,
        () => onEscapeRef.current?.(),
        "!suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible && !inSnippetMode && !renameInputVisible",
      );
    };

    return (
      <Editor
        path={`${TAB_MODEL_SCHEME}:${tabId}`}
        defaultLanguage="sql"
        theme={monacoTheme}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          ...editorOptions,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 2,
          automaticLayout: true,
        }}
      />
    );
  },
);

function currentRunTarget(editor: monaco.editor.IStandaloneCodeEditor): {
  sql: string;
  range: monaco.Range | null;
} {
  const model = editor.getModel();
  if (!model) return { sql: "", range: null };

  const selection = editor.getSelection();
  if (selection && !selection.isEmpty()) {
    const text = model.getValueInRange(selection);
    return text.trim() ? { sql: text, range: null } : { sql: "", range: null };
  }

  const pos = editor.getPosition();
  if (!pos) return { sql: "", range: null };
  const stmt = statementAtOffset(model.getValue(), model.getOffsetAt(pos));
  if (!stmt) return { sql: "", range: null };
  return {
    sql: stmt.text,
    range: monaco.Range.fromPositions(
      model.getPositionAt(stmt.start),
      model.getPositionAt(stmt.end),
    ),
  };
}

// executeEdits puts the change on Monaco's undo stack.
async function formatBuffer(
  editor: monaco.editor.IStandaloneCodeEditor,
  serverFormat: ((sql: string) => Promise<string>) | undefined,
) {
  const model = editor.getModel();
  if (!model) return;

  const selection = editor.getSelection();
  const hasSelection = selection && !selection.isEmpty();
  const range = hasSelection ? selection : model.getFullModelRange();
  const source = model.getValueInRange(range);
  if (!source.trim()) return;

  // The user can keep typing during the server round trip. Skip the edit if the
  // buffer changed, or it would overwrite those keystrokes.
  const versionBefore = model.getAlternativeVersionId();

  let formatted: string | null = null;
  if (serverFormat) {
    try {
      formatted = await serverFormat(source);
    } catch {
      // Fall through to the local formatter, which reports its own failure.
    }
  }
  if (formatted == null) {
    try {
      formatted = formatSql(source, {
        language: "clickhouse",
        keywordCase: "upper",
        tabWidth: 2,
        linesBetweenQueries: 2,
      });
    } catch (err) {
      notifyError(
        "Format failed",
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
  }

  if (
    editor.getModel() !== model ||
    model.getAlternativeVersionId() !== versionBefore
  ) {
    notifications.show({
      color: "yellow",
      title: "Format skipped",
      message:
        "The tab or its SQL changed during formatting. Run Format again.",
    });
    return;
  }

  editor.executeEdits("chgui.format-sql", [
    { range, text: formatted, forceMoveMarkers: true },
  ]);
  editor.pushUndoStop();
}
