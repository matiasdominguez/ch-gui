import { createTheme, type CSSVariablesResolver } from "@mantine/core";
import type { IconProps } from "@phosphor-icons/react";
import type { editor } from "monaco-editor";

export const theme = createTheme({
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
  fontFamilyMonospace:
    'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, monospace',
  primaryColor: "accent",
  primaryShade: { light: 6, dark: 6 },
  colors: {
    // Shade 6 is the filled-button blue, dark enough for white text at AA.
    accent: [
      "#e8f2ff",
      "#cfe3ff",
      "#9fc8ff",
      "#6badff",
      "#4099ff",
      "#1f8aff",
      "#0867d6",
      "#0558b8",
      "#044a9c",
      "#033b7d",
    ],
    dark: [
      "#ececec",
      "#c8c8cc",
      "#a1a1a6",
      "#7c7c82",
      "#3a3a3d",
      "#323235",
      "#2a2a2d",
      "#1c1c1e",
      "#18181a",
      "#131315",
    ],
    // Shade 6 is dark enough for white text at AA, which Mantine's stock red does not.
    red: [
      "#fff0ef",
      "#ffdcd9",
      "#ffb8b2",
      "#ff9189",
      "#ff6961",
      "#f04a3f",
      "#d92d20",
      "#b9261b",
      "#982016",
      "#771911",
    ],
    gray: [
      "#f7f7f8",
      "#f0f0f2",
      "#e6e6e9",
      "#dadade",
      "#d1d1d6",
      "#a8a8ae",
      "#6e6e73",
      "#515155",
      "#3a3a3d",
      "#1d1d1f",
    ],
  },
  fontSizes: {
    xs: "12px",
    sm: "13px",
    md: "14px",
    lg: "16px",
    xl: "20px",
  },
  lineHeights: { xs: "1.4", sm: "1.45", md: "1.5", lg: "1.5", xl: "1.4" },
  radius: { xs: "3px", sm: "5px", md: "6px", lg: "8px", xl: "12px" },
  defaultRadius: "md",
  spacing: { xs: "8px", sm: "12px", md: "16px", lg: "20px", xl: "28px" },
  headings: { fontWeight: "600" },
  cursorType: "default",
  components: {
    ActionIcon: { defaultProps: { color: "gray", variant: "subtle" } },
    Button: { defaultProps: { radius: "md" } },
    Menu: { defaultProps: { shadow: "lg", radius: "lg" } },
    Modal: { defaultProps: { radius: "xl", shadow: "xl" } },
    Tooltip: { defaultProps: { radius: "sm" } },
  },
});

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-body": "#ffffff",
    "--mantine-color-dimmed": "#6e6e73",
    "--mantine-color-default-border": "#dcdce0",
    "--mantine-color-placeholder": "#a1a1a6",
  },
  dark: {
    "--mantine-color-body": "#1c1c1e",
    "--mantine-color-dimmed": "#a1a1a6",
    "--mantine-color-default-border": "#38383b",
    "--mantine-color-placeholder": "#6e6e73",
  },
});

export const iconDefaults: IconProps = { size: 15, weight: "regular" };

type EditorTheme = { name: string; data: editor.IStandaloneThemeData };
const editorTheme = (
  name: string,
  base: "vs" | "vs-dark",
  colors: Record<string, string>,
  rules: editor.ITokenThemeRule[],
): EditorTheme => ({ name, data: { base, inherit: true, colors, rules } });

/** Monaco's base themes key SQL tokens as `keyword.sql`, so a rule must name
 * the suffix to outrank them. */
const sql = (rules: editor.ITokenThemeRule[]) =>
  rules.flatMap((r) => [r, { ...r, token: `${r.token}.sql` }]);

export const editorThemes: Record<"light" | "dark", EditorTheme> = {
  light: editorTheme(
    "chgui-light",
    "vs",
    {
      "editor.background": "#ffffff",
      "editor.foreground": "#1d1d1f",
      "editorLineNumber.foreground": "#b4b4b9",
      "editorLineNumber.activeForeground": "#6e6e73",
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#b3d7ff",
      "editor.inactiveSelectionBackground": "#dcdce0",
      "editorCursor.foreground": "#1d1d1f",
      "editorIndentGuide.background1": "#ececee",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#dcdce0",
      "scrollbarSlider.background": "#00000020",
      "scrollbarSlider.hoverBackground": "#00000035",
    },
    sql([
      { token: "keyword", foreground: "9b2393", fontStyle: "bold" },
      { token: "string", foreground: "c41a16" },
      { token: "number", foreground: "1c00cf" },
      { token: "comment", foreground: "5d6c79", fontStyle: "italic" },
      { token: "predefined", foreground: "6c36a9" },
      { token: "operator", foreground: "1d1d1f" },
    ]),
  ),
  dark: editorTheme(
    "chgui-dark",
    "vs-dark",
    {
      "editor.background": "#1c1c1e",
      "editor.foreground": "#e6e6e6",
      "editorLineNumber.foreground": "#56565b",
      "editorLineNumber.activeForeground": "#a1a1a6",
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#264f78",
      "editor.inactiveSelectionBackground": "#3a3a3d",
      "editorCursor.foreground": "#ececec",
      "editorIndentGuide.background1": "#2c2c2f",
      "editorWidget.background": "#2c2c2e",
      "editorWidget.border": "#3a3a3d",
      "scrollbarSlider.background": "#ffffff18",
      "scrollbarSlider.hoverBackground": "#ffffff2c",
    },
    sql([
      { token: "keyword", foreground: "ff7ab2", fontStyle: "bold" },
      { token: "string", foreground: "ff8170" },
      { token: "number", foreground: "d9c97c" },
      { token: "comment", foreground: "7f8c98", fontStyle: "italic" },
      { token: "predefined", foreground: "b281eb" },
      { token: "operator", foreground: "e6e6e6" },
    ]),
  ),
};

export const editorOptions: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  lineHeight: 20,
  fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
  padding: { top: 10 },
  renderLineHighlight: "none",
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  lineNumbersMinChars: 3,
};
