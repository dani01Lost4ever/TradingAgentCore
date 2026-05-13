export type Theme = 'aurora-dark' | 'dark' | 'light' | 'matrix' | 'midnight' | 'solarized' | 'nord' | 'gruvbox'
const THEME_STORAGE_KEY = 'theme'
const THEME_VERSION_KEY = 'theme_version'
const CURRENT_THEME_VERSION = '2'  // bump to force-migrate existing users to the new default

export const THEMES: { id: Theme; label: string; accent: string; bg: string; description: string }[] = [
  { id: 'aurora-dark', label: 'Aurora Dark', accent: '#C8FF00', bg: '#08090B', description: 'Refined dark — electric lime on near-black' },
  { id: 'dark',        label: 'Dark',        accent: '#00d4aa', bg: '#0d0f14', description: 'Default dark theme' },
  { id: 'light',       label: 'Light',       accent: '#0ea5e9', bg: '#f1f5f9', description: 'Clean light theme' },
  { id: 'solarized',   label: 'Solarized',   accent: '#268bd2', bg: '#fdf6e3', description: 'Warm tan, easy on the eyes' },
  { id: 'nord',        label: 'Nord',        accent: '#88c0d0', bg: '#2e3440', description: 'Arctic blue-grey' },
  { id: 'gruvbox',     label: 'Gruvbox',     accent: '#fabd2f', bg: '#282828', description: 'Earthy retro amber' },
  { id: 'matrix',      label: 'Matrix',      accent: '#00ff41', bg: '#000000', description: 'Phosphor green terminal' },
  { id: 'midnight',    label: 'Midnight',    accent: '#a78bfa', bg: '#07071a', description: 'Deep space violet' },
]

const THEME_IDS = new Set<Theme>(THEMES.map(t => t.id))

export function isTheme(value: string): value is Theme {
  return THEME_IDS.has(value as Theme)
}

export function getTheme(): Theme {
  try {
    // One-time migration: pre-aurora users had `dark` (or another legacy theme) stored.
    // Bump the version key to force everyone onto the new default on next load.
    const version = localStorage.getItem(THEME_VERSION_KEY)
    if (version !== CURRENT_THEME_VERSION) {
      localStorage.setItem(THEME_VERSION_KEY, CURRENT_THEME_VERSION)
      localStorage.setItem(THEME_STORAGE_KEY, 'aurora-dark')
      return 'aurora-dark'
    }
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored && isTheme(stored) ? stored : 'aurora-dark'
  } catch {
    return 'aurora-dark'
  }
}

export function applyTheme(theme: Theme): void {
  if (!isTheme(theme)) return
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {}
}
