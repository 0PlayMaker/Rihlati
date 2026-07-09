// theme.js — Phase 4.
// Every color in the app already flows through CSS custom properties
// on :root (--pink-deep, --surface, --ink, etc.), so a theme is just a
// set of overrides applied via document.documentElement.style — every
// existing rule that already says var(--whatever) picks up the new
// value instantly, with zero changes needed to any component's CSS.
//
// She picks ONE accent color, not two — "light" and "deep" shades are
// derived from it algorithmically (HSL lightness/saturation tweaks),
// which is what makes this "simple" rather than a wall of color
// pickers for every variable that happens to exist.
//
// Glass mode is the one exception that needs real new CSS (blur +
// transparency aren't expressible as a plain color variable) — that
// lives in style.css under body.theme-glass, gated by a class toggle.

const THEME_MODES = {
  light: {
    label: '☀️ فاتح',
    vars: { '--bg': '#FFF9F5', '--surface': '#FFFFFF', '--ink': '#4A4152', '--ink-soft': '#8B8394', '--ink-faint': '#C3BAC6', '--track': '#F1E7EC' }
  },
  dark: {
    label: '🌙 داكن',
    vars: { '--bg': '#1E1A22', '--surface': '#2A2530', '--ink': '#F0EBF2', '--ink-soft': '#B8AEC0', '--ink-faint': '#6E6578', '--track': '#3A3441' }
  },
  amoled: {
    label: '⚫ أسود عميق',
    vars: { '--bg': '#000000', '--surface': '#0D0D0D', '--ink': '#F0EBF2', '--ink-soft': '#A8A0B0', '--ink-faint': '#5A5262', '--track': '#1A1A1A' }
  },
  glass: {
    label: '🔮 زجاجي',
    vars: { '--bg': '#EDE3F5', '--surface': 'rgba(255,255,255,0.5)', '--ink': '#3A3145', '--ink-soft': '#756B85', '--ink-faint': '#A99FBB', '--track': 'rgba(255,255,255,0.35)' }
  },
  glassDark: {
    label: '🌌 زجاجي داكن',
    vars: { '--bg': '#15121C', '--surface': 'rgba(255,255,255,0.08)', '--ink': '#F0EBF2', '--ink-soft': '#C4BBD0', '--ink-faint': '#8A8095', '--track': 'rgba(255,255,255,0.14)' }
  }
};
const DEFAULT_ACCENT = '#E88FAE'; // the original --pink-deep

// ---------- hex <-> HSL, for deriving shades from one picked color ----------

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s; const l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = l * 255; return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: hue2rgb(h + 1 / 3) * 255, g: hue2rgb(h) * 255, b: hue2rgb(h - 1 / 3) * 255 };
}

// A pastel "light" tint for chip/badge backgrounds, and a saturated
// "deep" shade for buttons/active text/icons — same two-shade pattern
// every existing color in the palette already follows.
function deriveAccentShades(hex) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < 8) {
    // Near-grayscale input (including pure black/white) — stay on the
    // same gray axis rather than forcing a hue that isn't actually
    // there, which would otherwise make black and white (both hue=0,
    // sat=0 by convention) derive to the exact same tinted color.
    const lightRgb = hslToRgb(0, 0, 88);
    const deepRgb = hslToRgb(0, 0, Math.max(20, Math.min(l, 45)));
    return { light: rgbToHex(lightRgb.r, lightRgb.g, lightRgb.b), deep: rgbToHex(deepRgb.r, deepRgb.g, deepRgb.b) };
  }
  const lightRgb = hslToRgb(h, Math.min(s, 55), 88);
  const deepRgb = hslToRgb(h, Math.max(s, 40), 62);
  return { light: rgbToHex(lightRgb.r, lightRgb.g, lightRgb.b), deep: rgbToHex(deepRgb.r, deepRgb.g, deepRgb.b) };
}

// ---------- apply ----------

function applyTheme(mode, accentHex) {
  const preset = THEME_MODES[mode] || THEME_MODES.light;
  const root = document.documentElement.style;
  Object.entries(preset.vars).forEach(([k, v]) => root.setProperty(k, v));

  const { light, deep } = deriveAccentShades(accentHex || DEFAULT_ACCENT);
  root.setProperty('--pink', light);
  root.setProperty('--pink-deep', deep);
  const { r, g, b } = hexToRgb(deep);
  root.setProperty('--shadow-soft', `0 6px 20px rgba(${r}, ${g}, ${b}, 0.16)`);
  root.setProperty('--shadow-tap', `0 2px 8px rgba(${r}, ${g}, ${b}, 0.14)`);

  document.body.classList.toggle('theme-glass', mode === 'glass' || mode === 'glassDark');
  document.body.classList.toggle('theme-glass-dark', mode === 'glassDark');
  document.body.classList.toggle('theme-dark-ish', mode === 'dark' || mode === 'amoled' || mode === 'glassDark');
}

async function applyStoredTheme() {
  const settings = await db.settings.get(1);
  applyTheme(settings?.themeMode || 'light', settings?.accentColor || DEFAULT_ACCENT);
}

// ---------- Settings UI ----------

function renderThemeSection(currentMode, currentAccent, accentHistory) {
  const history = (accentHistory || []).filter(c => c !== (currentAccent || DEFAULT_ACCENT));
  return `
    <div class="card settings-card">
      <h2 class="card-title">المظهر</h2>
      <label class="field-label">لون التمييز (اضغطي لتغييره)</label>
      <input type="color" id="theme-accent-input" value="${currentAccent || DEFAULT_ACCENT}" class="theme-color-input">
      ${history.length ? `
        <div class="theme-history-row" id="theme-history-row">
          ${history.map(c => `<button class="theme-history-swatch" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
        </div>` : ''}
      <label class="field-label">الوضع</label>
      <div class="habit-type-chips theme-mode-chips" id="theme-mode-chips">
        ${Object.entries(THEME_MODES).map(([key, m]) => `
          <button class="chip theme-mode-chip ${key === (currentMode || 'light') ? 'active' : ''}" data-mode="${key}">${m.label}</button>
        `).join('')}
      </div>
      <div class="theme-preview" id="theme-preview">
        <div class="theme-preview-card">
          <span class="theme-preview-title">مثال</span>
          <button class="btn btn-primary btn-sm theme-preview-btn">زر رئيسي</button>
        </div>
      </div>
    </div>`;
}

function wireThemeSection(view) {
  const accentInput = document.getElementById('theme-accent-input');
  const modeChips = document.getElementById('theme-mode-chips');
  let selectedMode = modeChips.querySelector('.chip.active')?.dataset.mode || 'light';

  async function saveAndApply(newAccent) {
    const settings = await db.settings.get(1);
    const prevAccent = settings?.accentColor || DEFAULT_ACCENT;
    let history = settings?.accentColorHistory || [];
    // Keep the color she's moving AWAY from, so switching never loses
    // it — capped at 6 so the row doesn't grow forever.
    if (newAccent && newAccent !== prevAccent && !history.includes(prevAccent)) {
      history = [prevAccent, ...history].slice(0, 6);
    }
    await db.settings.update(1, { themeMode: selectedMode, accentColor: newAccent || prevAccent, accentColorHistory: history });
    applyTheme(selectedMode, newAccent || prevAccent);
    if (newAccent) renderSettingsPage([], view); // refresh so the history row reflects the new state
  }

  accentInput.addEventListener('change', () => saveAndApply(accentInput.value));
  const historyRow = document.getElementById('theme-history-row');
  if (historyRow) historyRow.querySelectorAll('.theme-history-swatch').forEach(sw => {
    sw.addEventListener('click', () => saveAndApply(sw.dataset.color));
  });
  modeChips.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedMode = chip.dataset.mode;
      modeChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
      saveAndApply();
    });
  });
}
