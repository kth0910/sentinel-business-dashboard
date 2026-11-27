// Shortcut labels are written Mac-style ('⌘⇧P'). On Windows/Linux they are shown with key names
// ('Ctrl+Shift+P'), matching how the key handlers read them (mod = ctrlKey off Mac).
export const isMacPlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Mac labels whose Windows binding is not a plain symbol swap. */
const WIN_OVERRIDES: Record<string, string> = {
  '⌘⌃L': 'Alt+Shift+L', // copy block link (textHandlers / EditorSurface: Alt+Shift+L off Mac)
};

const MOD_RUN = /([⌘⌥⇧⌃]+)\+?(↵)?/g;

function winMods(run: string): string {
  const hasCmd = run.includes('⌘');
  const names: string[] = [];
  if (hasCmd || run.includes('⌃')) names.push('Ctrl');
  // ⌘⌃ on Mac is Ctrl+Alt off Mac (see TextActionMenu's ⌘⌃E → Ctrl+Alt+E)
  if (run.includes('⌥') || (hasCmd && run.includes('⌃'))) names.push('Alt');
  if (run.includes('⇧')) names.push('Shift');
  return names.join('+');
}

/** Turn a Mac-style shortcut label (or a sentence containing one) into the label for this platform. */
export function keyComboLabel(label: string): string;
export function keyComboLabel(label: string | undefined): string | undefined;
export function keyComboLabel(label: string | undefined): string | undefined {
  if (!label || isMacPlatform) return label;
  const override = WIN_OVERRIDES[label];
  if (override) return override;
  return label.replace(MOD_RUN, (_, run: string, enter?: string) => `${winMods(run)}+${enter ? 'Enter' : ''}`);
}
