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
    vars: { '--bg': '#FFF9F5', '--surface': '#FFFFFF', '--ink': '#4A4152', '--ink-soft': '#8B8394', '--ink-faint': '#C3BAC6', '--track': '#F1E7EC', '--card-border': 'transparent', '--modal-bg': '#FFFFFF' }
  },
  dark: {
    label: '🌙 داكن',
    vars: { '--bg': '#17141C', '--surface': '#2E2838', '--ink': '#F5F1F7', '--ink-soft': '#BCB2C7', '--ink-faint': '#7A7186', '--track': '#3E3749', '--card-border': 'rgba(255,255,255,0.09)', '--modal-bg': '#2E2838' }
  },
  amoled: {
    label: '⚫ أسود عميق',
    vars: { '--bg': '#000000', '--surface': '#161616', '--ink': '#F5F1F7', '--ink-soft': '#B8AFC2', '--ink-faint': '#6B6373', '--track': '#242424', '--card-border': 'rgba(255,255,255,0.10)', '--modal-bg': '#161616' }
  },
  glass: {
    label: '🔮 زجاجي',
    // More transparent than the first pass at this — closer to the
    // glass quality the bottom bar already has, while staying light
    // rather than gray (a plain white surface behind the blur, not the
    // colorful backdrop showing through unfiltered).
    vars: { '--bg': '#EDE3F5', '--surface': 'rgba(255,255,255,0.5)', '--ink': '#3A3145', '--ink-soft': '#756B85', '--ink-faint': '#A99FBB', '--track': 'rgba(255,255,255,0.35)', '--card-border': 'rgba(255,255,255,0.6)', '--modal-bg': 'rgba(255,255,255,0.7)' }
  },
  glassDark: {
    label: '🌌 زجاجي داكن',
    vars: { '--bg': '#15121C', '--surface': 'rgba(255,255,255,0.08)', '--ink': '#F5F1F7', '--ink-soft': '#C4BBD0', '--ink-faint': '#8A8095', '--track': 'rgba(255,255,255,0.14)', '--card-border': 'rgba(255,255,255,0.16)', '--modal-bg': 'rgba(20,16,28,0.9)' }
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

// ---------- reusable HSL slider picker ----------
// A native <input type="color"> already allows picking any color, but
// the wheel/spectrum is hidden behind a tap and not very visible as a
// concept — explicit H/S/L sliders make "any hue, any saturation, any
// brightness" directly visible and adjustable in the page itself.

// Accepts either a plain hex (#RRGGBB) or an rgba(...) string, always
// returns {r,g,b,a} with a as 0-100 for slider convenience.
function parseColorToRgba(str) {
  if (!str) return { r: 232, g: 143, b: 174, a: 100 };
  const rgbaMatch = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    return { r: Number(rgbaMatch[1]), g: Number(rgbaMatch[2]), b: Number(rgbaMatch[3]), a: rgbaMatch[4] != null ? Math.round(Number(rgbaMatch[4]) * 100) : 100 };
  }
  const { r, g, b } = hexToRgb(str);
  return { r, g, b, a: 100 };
}
function rgbaToOutputString(r, g, b, a) {
  r = Math.round(r); g = Math.round(g); b = Math.round(b);
  return a >= 100 ? rgbToHex(r, g, b) : `rgba(${r}, ${g}, ${b}, ${(a / 100).toFixed(2)})`;
}

function hslPickerHtml(idPrefix, currentColor, { withAlpha } = {}) {
  const { r, g, b, a } = parseColorToRgba(currentColor);
  const { h, s, l } = rgbToHsl(r, g, b);
  return `
    <div class="hsl-picker" id="${idPrefix}-picker">
      <div class="hsl-swatch" id="${idPrefix}-swatch" style="background:${currentColor}"></div>
      <div class="hsl-sliders">
        <div class="hsl-slider-row"><label for="${idPrefix}-hue">الصبغة</label><input type="range" min="0" max="360" value="${Math.round(h)}" id="${idPrefix}-hue" class="hsl-slider hsl-slider-hue"></div>
        <div class="hsl-slider-row"><label for="${idPrefix}-sat">التشبّع</label><input type="range" min="0" max="100" value="${Math.round(s)}" id="${idPrefix}-sat" class="hsl-slider"></div>
        <div class="hsl-slider-row"><label for="${idPrefix}-light">السطوع</label><input type="range" min="0" max="100" value="${Math.round(l)}" id="${idPrefix}-light" class="hsl-slider"></div>
        ${withAlpha ? `<div class="hsl-slider-row"><label for="${idPrefix}-alpha">الشفافية</label><input type="range" min="0" max="100" value="${Math.round(a)}" id="${idPrefix}-alpha" class="hsl-slider"></div>` : ''}
      </div>
      <input type="text" class="text-input theme-hex-input" id="${idPrefix}-hex" value="${currentColor}" maxlength="30">
    </div>`;
}

function wireHslPicker(idPrefix, onChange, { withAlpha } = {}) {
  const hueInput = document.getElementById(`${idPrefix}-hue`);
  const satInput = document.getElementById(`${idPrefix}-sat`);
  const lightInput = document.getElementById(`${idPrefix}-light`);
  const alphaInput = withAlpha ? document.getElementById(`${idPrefix}-alpha`) : null;
  const hexInput = document.getElementById(`${idPrefix}-hex`);
  const swatch = document.getElementById(`${idPrefix}-swatch`);

  // Belt-and-suspenders: even on the new dedicated page, stop every
  // slider interaction from bubbling at all — no ambiguity left to
  // chance regardless of surrounding structure.
  const allInputs = [hueInput, satInput, lightInput, alphaInput].filter(Boolean);
  allInputs.forEach(input => {
    ['click', 'pointerdown', 'touchstart', 'mousedown'].forEach(evt => {
      input.addEventListener(evt, (e) => e.stopPropagation());
    });
  });

  function fromSliders() {
    const rgb = hslToRgb(Number(hueInput.value), Number(satInput.value), Number(lightInput.value));
    const alpha = alphaInput ? Number(alphaInput.value) : 100;
    const out = rgbaToOutputString(rgb.r, rgb.g, rgb.b, alpha);
    swatch.style.background = out;
    hexInput.value = out;
    return out;
  }
  allInputs.forEach(input => {
    input.addEventListener('input', () => onChange(fromSliders()));
  });
  hexInput.addEventListener('change', () => {
    const val = hexInput.value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(val) && !/^rgba?\(/.test(val)) return;
    const { r, g, b, a } = parseColorToRgba(val);
    const { h, s, l } = rgbToHsl(r, g, b);
    hueInput.value = Math.round(h);
    satInput.value = Math.round(s);
    lightInput.value = Math.round(l);
    if (alphaInput) alphaInput.value = Math.round(a);
    swatch.style.background = val;
    onChange(val);
  });
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

function applyTheme(mode, accentHex, opts = {}) {
  const preset = THEME_MODES[mode] || THEME_MODES.light;
  const root = document.documentElement.style;
  Object.entries(preset.vars).forEach(([k, v]) => root.setProperty(k, v));

  const { light, deep } = deriveAccentShades(accentHex || DEFAULT_ACCENT);
  root.setProperty('--pink', light);
  root.setProperty('--pink-deep', deep);
  const { r, g, b } = hexToRgb(deep);
  root.setProperty('--pink-deep-rgb', `${r}, ${g}, ${b}`);
  root.setProperty('--shadow-soft', `0 6px 20px rgba(${r}, ${g}, ${b}, 0.16)`);
  root.setProperty('--shadow-tap', `0 2px 8px rgba(${r}, ${g}, ${b}, 0.14)`);

  // Custom overrides layer on top of whatever the mode set — her own
  // picked value (hex or rgba), not derived/tinted like the accent,
  // since these don't need light+deep variants the way a single
  // accent choice does.
  if (opts.bg) root.setProperty('--bg', opts.bg);
  if (opts.modalBg) root.setProperty('--modal-bg', opts.modalBg);
  if (opts.textColor) root.setProperty('--ink', opts.textColor);
  if (opts.subtextColor) root.setProperty('--ink-soft', opts.subtextColor);
  root.setProperty('--title-color', opts.titleColor || 'var(--ink)');
  if (opts.bottomBarColor) root.setProperty('--bottom-bar-color', opts.bottomBarColor);
  else root.removeProperty('--bottom-bar-color');

  // Buttons default to the accent's deep shade (same as before this
  // was customizable); capsules get their own color, defaulting to
  // the same, with an rgb triplet for the glow. parseColorToRgba
  // (rather than hexToRgb) since either can now be an rgba() string
  // from the transparency slider.
  const btnHex = opts.btnColor || deep;
  root.setProperty('--btn-color', btnHex);
  const capsuleHex = opts.capsuleColor || deep;
  root.setProperty('--capsule-color', capsuleHex);
  const cr = parseColorToRgba(capsuleHex);
  root.setProperty('--capsule-color-rgb', `${cr.r}, ${cr.g}, ${cr.b}`);

  // Glass blur amount — customizable, defaults to the original 20px.
  const blurPx = opts.blurAmount != null ? opts.blurAmount : 20;
  root.setProperty('--glass-blur', `${blurPx}px`);

  // Per-tile accents for the six section cards. Cleared (not left stale)
  // when she removes a custom colour, so the tile falls back to its
  // palette default rather than keeping a colour she just deleted.
  TILE_ACCENT_FIELDS.forEach(f => {
    const v = opts.tiles ? opts.tiles[f.settingsKey] : null;
    if (v) root.setProperty(`--tile-${f.id}`, v);
    else root.removeProperty(`--tile-${f.id}`);
  });

  // Ring tones and semantic status colours. Cleared rather than left stale
  // when removed, so a deleted custom colour actually goes away.
  [...RING_COLOR_FIELDS, ...SEMANTIC_COLOR_FIELDS].forEach(f => {
    const v = opts.extras ? opts.extras[f.settingsKey] : null;
    if (v) root.setProperty(f.cssVar, v);
    else root.removeProperty(f.cssVar);
  });

  // Layout scales. Expressed as multipliers so every size and spacing token
  // derives from them — one slider moves the whole app, rather than a
  // hundred hardcoded pixel values needing individual attention.
  LAYOUT_FIELDS.forEach(f => {
    const v = opts.extras ? opts.extras[f.settingsKey] : null;
    root.setProperty(f.cssVar, String((v ?? f.def) / 100));
  });

  document.body.classList.toggle('theme-glass', mode === 'glass' || mode === 'glassDark');
  document.body.classList.toggle('theme-glass-dark', mode === 'glassDark');
  document.body.classList.toggle('theme-dark-ish', mode === 'dark' || mode === 'amoled' || mode === 'glassDark');
}

async function applyStoredTheme() {
  const settings = await db.settings.get(1);
  applyTheme(settings?.themeMode || 'light', settings?.accentColor || DEFAULT_ACCENT, {
    bg: settings?.customBgColor,
    modalBg: settings?.customModalBgColor,
    btnColor: settings?.customBtnColor,
    capsuleColor: settings?.customCapsuleColor,
    titleColor: settings?.customTitleColor,
    textColor: settings?.customTextColor,
    subtextColor: settings?.customSubtextColor,
    bottomBarColor: settings?.customBottomBarColor,
    blurAmount: settings?.customBlurAmount,
    tiles: Object.fromEntries(TILE_ACCENT_FIELDS.map(f => [f.settingsKey, settings?.[f.settingsKey]])),
    extras: Object.fromEntries(
      [...RING_COLOR_FIELDS, ...SEMANTIC_COLOR_FIELDS, ...LAYOUT_FIELDS]
        .map(f => [f.settingsKey, settings?.[f.settingsKey]])
    )
  });
}

// Everything except accent (which has history + derives light/deep
// shades) follows this same shape: a plain color, defaulting to the
// mode's own value unless she's overridden it, with a "use default"
// clear button. Looping over this list is what keeps 7 near-identical
// color pickers from being 7 copies of the same markup+wiring.
const CUSTOM_COLOR_FIELDS = [
  { key: 'bg', settingsKey: 'customBgColor', label: 'الخلفية', group: 'أساسي', withAlpha: true, fallback: () => document.documentElement.style.getPropertyValue('--bg') || '#FFF9F5' },
  { key: 'btn', settingsKey: 'customBtnColor', label: 'الأزرار', group: 'عناصر تفاعلية', withAlpha: true, fallback: () => DEFAULT_ACCENT },
  { key: 'capsule', settingsKey: 'customCapsuleColor', label: 'الكبسولات (مثل زر الهدف)', group: 'عناصر تفاعلية', withAlpha: true, fallback: () => DEFAULT_ACCENT },
  { key: 'modalbg', settingsKey: 'customModalBgColor', label: 'النوافذ المنبثقة', group: 'أسطح', withAlpha: true, fallback: () => document.documentElement.style.getPropertyValue('--modal-bg') || '#FFFFFF' },
  { key: 'bottombar', settingsKey: 'customBottomBarColor', label: 'الشريط السفلي', group: 'أسطح', withAlpha: true, fallback: () => document.documentElement.style.getPropertyValue('--surface') || '#FFFFFF' },
  { key: 'title', settingsKey: 'customTitleColor', label: 'العناوين', group: 'نصوص', withAlpha: false, fallback: () => '#4A4152' },
  { key: 'text', settingsKey: 'customTextColor', label: 'النص', group: 'نصوص', withAlpha: false, fallback: () => '#4A4152' },
  { key: 'subtext', settingsKey: 'customSubtextColor', label: 'النص الفرعي', group: 'نصوص', withAlpha: false, fallback: () => '#8B8394' }
];
// The six section tiles on Home each carry their own accent. Making them
// customisable is the difference between "a theme" and "a theme that
// actually covers what she looks at most".
const TILE_ACCENT_FIELDS = [
  { id: 'food-action',    settingsKey: 'tileFoodColor',    label: '🍽️ الطعام',      fallback: 'var(--yellow-deep)' },
  { id: 'worship-action', settingsKey: 'tileWorshipColor', label: '🕌 العبادة',      fallback: 'var(--mint-deep)' },
  { id: 'diary-action',   settingsKey: 'tileDiaryColor',   label: '📔 يومياتي',      fallback: 'var(--lavender-deep)' },
  { id: 'period-action',  settingsKey: 'tilePeriodColor',  label: '🌙 الدورة',       fallback: 'var(--rose-deep)' },
  { id: 'economy-action', settingsKey: 'tileEconomyColor', label: '💰 الاقتصاد',     fallback: 'var(--mint-deep)' },
  { id: 'body-action',    settingsKey: 'tileBodyColor',    label: '⚖️ الصحة',        fallback: 'var(--blue-deep)' }
];

// The eight home rings and the four semantic status colours were already
// theme VARIABLES — but with no picker to reach them, which makes them
// tidy, not customisable. These close that gap.
const RING_COLOR_FIELDS = [
  { key: 'ringcare',    settingsKey: 'ringCareColor',    cssVar: '--ring-care',    label: '🌅 الروتين والعناية' },
  { key: 'ringworship', settingsKey: 'ringWorshipColor', cssVar: '--ring-worship', label: '🕌 العبادة والأذكار' },
  { key: 'ringperiod',  settingsKey: 'ringPeriodColor',  cssVar: '--ring-period',  label: '🌸 الدورة الشهرية' },
  { key: 'ringhealth',  settingsKey: 'ringHealthColor',  cssVar: '--ring-health',  label: '⚖️ الصحة والوزن' }
];

const SEMANTIC_COLOR_FIELDS = [
  { key: 'success', settingsKey: 'semSuccessColor', cssVar: '--success-strong', label: '✅ نجاح / إنجاز' },
  { key: 'warning', settingsKey: 'semWarningColor', cssVar: '--warning-strong', label: '⚠️ تنبيه / اقتراب' },
  { key: 'danger',  settingsKey: 'semDangerColor',  cssVar: '--danger-strong',  label: '⛔ خطر / انتكاسة' },
  { key: 'info',    settingsKey: 'semInfoColor',    cssVar: '--info-strong',    label: 'ℹ️ معلومة' }
];

// Layout levers. These are not decoration — text size in particular is an
// accessibility need, and an app you have to squint at is an app you stop
// opening.
const LAYOUT_FIELDS = [
  { key: 'fontScale',  settingsKey: 'fontScale',  cssVar: '--font-scale',  label: 'حجم الخط',      min: 85,  max: 130, step: 5,  def: 100, unit: '٪' },
  { key: 'radiusScale',settingsKey: 'radiusScale',cssVar: '--radius-scale',label: 'استدارة الحواف', min: 0,   max: 150, step: 10, def: 100, unit: '٪' },
  { key: 'density',    settingsKey: 'density',    cssVar: '--space-scale', label: 'التباعد',        min: 80,  max: 120, step: 5,  def: 100, unit: '٪' }
];

const THEME_SETTINGS_KEYS = ['themeMode', 'accentColor',
  ...CUSTOM_COLOR_FIELDS.map(f => f.settingsKey),
  ...TILE_ACCENT_FIELDS.map(f => f.settingsKey),
  ...RING_COLOR_FIELDS.map(f => f.settingsKey),
  ...SEMANTIC_COLOR_FIELDS.map(f => f.settingsKey),
  ...LAYOUT_FIELDS.map(f => f.settingsKey),
  'customBlurAmount'];

// ---------- Settings page: minimal — mode + presets + link to editor ----------

function renderThemeSection(currentMode, currentAccent, presets) {
  return `
    <div class="card settings-card">
      <h3 class="card-title">الوضع</h3>
      <div class="habit-type-chips theme-mode-chips" id="theme-mode-chips">
        ${Object.entries(THEME_MODES).map(([key, m]) => `
          <button class="chip theme-mode-chip ${key === (currentMode || 'light') ? 'active' : ''}" data-mode="${key}">${m.label}</button>
        `).join('')}
        ${(presets || []).map(p => `<button class="chip theme-preset-chip" data-preset-id="${p.id}">🎨 ${escapeHtml(p.name)}</button>`).join('')}
      </div>
      <div class="theme-quick-row">
        <a class="btn btn-secondary btn-sm" href="#/theme-editor">🎨 تخصيص كامل</a>
        <button class="btn btn-text btn-sm theme-restore-quick" id="theme-restore-quick">↺ المظهر الافتراضي</button>
      </div>
    </div>`;
}

async function restoreDefaultTheme() {
  const reset = { themeMode: 'light', accentColor: DEFAULT_ACCENT, customBlurAmount: null };
  [...CUSTOM_COLOR_FIELDS, ...TILE_ACCENT_FIELDS, ...RING_COLOR_FIELDS, ...SEMANTIC_COLOR_FIELDS, ...LAYOUT_FIELDS]
    .forEach(f => { reset[f.settingsKey] = null; });
  await db.settings.update(1, reset);
  await applyStoredTheme();
}

function wireThemeSection(view) {
  const restoreBtn = document.getElementById('theme-restore-quick');
  if (restoreBtn) restoreBtn.addEventListener('click', async () => {
    if (!confirm('استعادة المظهر الافتراضي؟ (لن تُحذف مظاهرك المحفوظة)')) return;
    await restoreDefaultTheme();
    toast('↺ عاد المظهر الافتراضي');
    renderSettingsPage([], document.getElementById('view'));
  });

  const modeChips = document.getElementById('theme-mode-chips');
  modeChips.querySelectorAll('.theme-mode-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const mode = chip.dataset.mode;
      modeChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
      await db.settings.update(1, { themeMode: mode });
      await applyStoredTheme();
    });
  });
  modeChips.querySelectorAll('.theme-preset-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      modeChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
      await applyCustomPreset(Number(chip.dataset.presetId));
    });
  });
}

// ---------- custom presets ----------

async function saveCustomPreset(name) {
  const settings = await db.settings.get(1);
  const presets = settings.customThemePresets || [];
  if (presets.length >= 3) return false;
  const preset = { id: Date.now(), name };
  THEME_SETTINGS_KEYS.forEach(k => { preset[k] = settings[k]; });
  await db.settings.update(1, { customThemePresets: [...presets, preset] });
  return true;
}
async function applyCustomPreset(presetId) {
  const settings = await db.settings.get(1);
  const preset = (settings.customThemePresets || []).find(p => p.id === presetId);
  if (!preset) return;
  const toApply = {};
  THEME_SETTINGS_KEYS.forEach(k => { toApply[k] = preset[k] ?? null; });
  await db.settings.update(1, toApply);
  await applyStoredTheme();
}
async function updateCustomPresetToCurrent(presetId) {
  const settings = await db.settings.get(1);
  const presets = (settings.customThemePresets || []).map(p => {
    if (p.id !== presetId) return p;
    const updated = { id: p.id, name: p.name };
    THEME_SETTINGS_KEYS.forEach(k => { updated[k] = settings[k]; });
    return updated;
  });
  await db.settings.update(1, { customThemePresets: presets });
}
async function deleteCustomPreset(presetId) {
  const settings = await db.settings.get(1);
  const presets = (settings.customThemePresets || []).filter(p => p.id !== presetId);
  await db.settings.update(1, { customThemePresets: presets });
}

// ---------- dedicated theme editor page ----------
// Nothing here ever re-renders the page itself on a slider change —
// only apply the theme live and save. That's the actual fix for the
// "sliders close the panel" bug: it wasn't the slider or the details
// element, it was the accent picker's onChange rebuilding the whole
// page to refresh its history row, which created a brand-new (closed)
// details element in place of the one she had open.

function themeGroupSectionHtml(groupName, fields, cc) {
  return `
    <div class="card settings-card">
      <h2 class="card-title">${groupName}</h2>
      ${fields.map(f => `
        <label class="field-label">${f.label}</label>
        ${hslPickerHtml(`theme-${f.key}`, cc[f.settingsKey] || f.fallback(), { withAlpha: f.withAlpha })}
        <button class="btn btn-text btn-sm theme-clear-btn" data-clear="${f.settingsKey}">استخدام الافتراضي</button>
      `).join('<div class="theme-field-sep"></div>')}
    </div>`;
}

async function renderThemeEditorPage(params, view) {
  const settings = await db.settings.get(1);
  const currentAccent = settings?.accentColor || DEFAULT_ACCENT;
  const accentHistory = (settings?.accentColorHistory || []).filter(c => c !== currentAccent);
  const cc = settings || {};
  const groups = ['أساسي', 'عناصر تفاعلية', 'أسطح', 'نصوص'];
  const presets = settings?.customThemePresets || [];

  view.innerHTML = `
    <div class="page-header">
      <button class="icon-btn" aria-label="رجوع" id="theme-editor-back">→</button>
      <h1>تخصيص المظهر</h1>
    </div>

    <div class="settings-jump">
      <button class="settings-jump-chip" data-jump="th-accent">🎨 اللون الأساسي</button>
      <button class="settings-jump-chip" data-jump="th-surfaces">🖼️ الأسطح والنصوص</button>
      <button class="settings-jump-chip" data-jump="th-tiles">🔲 بطاقات الأقسام</button>
      <button class="settings-jump-chip" data-jump="th-rings">⭕ الدوائر</button>
      <button class="settings-jump-chip" data-jump="th-status">🚦 ألوان الحالة</button>
      <button class="settings-jump-chip" data-jump="th-layout">📐 الشكل والحجم</button>
      <button class="settings-jump-chip" data-jump="th-presets">💾 مظاهرك</button>
    </div>

    <div class="card">
      <div class="theme-preview" id="theme-preview">
        <div class="theme-preview-card">
          <span class="theme-preview-title">مثال</span>
          <button class="btn btn-primary btn-sm theme-preview-btn">زر رئيسي</button>
          <button class="capsule-btn theme-preview-capsule">كبسولة</button>
        </div>
      </div>
      <button class="btn btn-text btn-block theme-restore-quick" id="theme-restore-default">↺ استعادة المظهر الافتراضي</button>
    </div>

    <h2 class="settings-group-title" id="th-accent">🎨 اللون الأساسي</h2>
    <div class="card settings-card">
      ${hslPickerHtml('theme-accent', currentAccent)}
      <div class="theme-history-row" id="theme-history-row">
        ${accentHistory.map(c => `<button class="theme-history-swatch" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
      </div>
      <p class="settings-note">يشتقّ منه لون الأزرار والكبسولات تلقائياً ما لم تغيّريها بنفسك.</p>
    </div>

    <h2 class="settings-group-title" id="th-surfaces">🖼️ الأسطح والنصوص</h2>
    ${['أساسي', 'عناصر تفاعلية', 'أسطح', 'نصوص'].map(g => themeGroupSectionHtml(g, CUSTOM_COLOR_FIELDS.filter(f => f.group === g), cc)).join('')}

    <h2 class="settings-group-title" id="th-tiles">🔲 بطاقات الأقسام</h2>
    <div class="card settings-card">
      <p class="settings-note">البطاقات الست حول التقويم في الصفحة الرئيسية.</p>
      ${TILE_ACCENT_FIELDS.map(f => `
        <label class="field-label">${f.label}</label>
        ${hslPickerHtml(`tile-${f.id}`, cc[f.settingsKey] || DEFAULT_ACCENT)}
        <button class="btn btn-text btn-sm theme-clear-btn" data-clear="${f.settingsKey}">اللون الافتراضي</button>
      `).join('<div class="theme-field-sep"></div>')}
    </div>

    <h2 class="settings-group-title" id="th-rings">⭕ ألوان الدوائر</h2>
    <div class="card settings-card">
      <p class="settings-note">كل مجال من حياتك بلونه، ليُميَّز بلمحة.</p>
      ${RING_COLOR_FIELDS.map(f => `
        <label class="field-label">${f.label}</label>
        ${hslPickerHtml(`ring-${f.key}`, cc[f.settingsKey] || DEFAULT_ACCENT)}
        <button class="btn btn-text btn-sm theme-clear-btn" data-clear="${f.settingsKey}">اللون الافتراضي</button>
      `).join('<div class="theme-field-sep"></div>')}
    </div>

    <h2 class="settings-group-title" id="th-status">🚦 ألوان الحالة</h2>
    <div class="card settings-card">
      <p class="settings-note">تُستخدم في كل التطبيق: الإنجاز، التنبيه، الانتكاسة. تغييرها هنا يغيّرها في كل مكان.</p>
      ${SEMANTIC_COLOR_FIELDS.map(f => `
        <label class="field-label">${f.label}</label>
        ${hslPickerHtml(`sem-${f.key}`, cc[f.settingsKey] || DEFAULT_ACCENT)}
        <button class="btn btn-text btn-sm theme-clear-btn" data-clear="${f.settingsKey}">اللون الافتراضي</button>
      `).join('<div class="theme-field-sep"></div>')}
    </div>

    <h2 class="settings-group-title" id="th-layout">📐 الشكل والحجم</h2>
    <div class="card settings-card">
      ${LAYOUT_FIELDS.map(f => `
        <div class="hsl-slider-row layout-slider-row">
          <label for="layout-${f.key}">${f.label}</label>
          <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${cc[f.settingsKey] ?? f.def}" id="layout-${f.key}" class="hsl-slider" data-layout="${f.settingsKey}">
          <span class="layout-val" id="layout-${f.key}-val">${toArabicNumeral(cc[f.settingsKey] ?? f.def)}${f.unit}</span>
        </div>`).join('')}
      <p class="settings-note">حجم الخط ليس زينة — تطبيق تحتاجين لحدج عينيك لقراءته هو تطبيق تتوقّفين عن فتحه.</p>
    </div>

    <div class="card settings-card">
      <h2 class="card-title">التمويه الزجاجي</h2>
      <p class="settings-note">يؤثر فقط في الأوضاع الزجاجية.</p>
      <div class="hsl-slider-row"><label for="theme-blur-input">مقدار التمويه</label><input type="range" min="0" max="40" value="${cc.customBlurAmount ?? 20}" id="theme-blur-input" class="hsl-slider"></div>
    </div>

    <h2 class="settings-group-title" id="th-presets">💾 مظاهرك المحفوظة</h2>
    <div class="card settings-card">
      ${presets.length >= 3 ? `<p class="settings-note">وصلتِ للحد الأقصى (٣ مظاهر). احذفي واحداً لإضافة آخر.</p>` : `
        <div class="theme-accent-row">
          <input class="text-input" id="theme-preset-name-input" placeholder="اسم المظهر" maxlength="20">
          <button class="btn btn-secondary btn-sm" id="theme-save-preset-btn">حفظ الحالي</button>
        </div>`}
      ${presets.length ? `
        <div class="theme-presets-list" id="theme-presets-list">
          ${presets.map(p => `
            <div class="theme-preset-row" data-preset-id="${p.id}">
              <span>🎨 ${escapeHtml(p.name)}</span>
              <div class="theme-preset-actions">
                <button class="link-btn theme-preset-apply" data-id="${p.id}">تطبيق</button>
                <button class="link-btn theme-preset-update" data-id="${p.id}">تحديث</button>
                <button class="link-btn theme-preset-delete" data-id="${p.id}">حذف</button>
              </div>
            </div>`).join('')}
        </div>` : '<p class="empty-state-sub">لا مظاهر محفوظة بعد.</p>'}
    </div>
  `;
  document.getElementById('theme-editor-back').addEventListener('click', () => window.history.back());

  // Every interaction below applies live + saves, and updates AT MOST
  // the one small piece of DOM that actually needs it (the accent
  // history row) — never the page itself.
  async function saveField(key, value) {
    await db.settings.update(1, { [key]: value });
  }
  async function liveApply() {
    const s = await db.settings.get(1);
    const opts = {};
    CUSTOM_COLOR_FIELDS.forEach(f => { opts[camelFromKey(f)] = s[f.settingsKey]; });
    opts.bottomBarColor = s.customBottomBarColor;
    opts.blurAmount = s.customBlurAmount;
    opts.tiles = Object.fromEntries(TILE_ACCENT_FIELDS.map(f => [f.settingsKey, s[f.settingsKey]]));
    opts.extras = Object.fromEntries(
      [...RING_COLOR_FIELDS, ...SEMANTIC_COLOR_FIELDS, ...LAYOUT_FIELDS].map(f => [f.settingsKey, s[f.settingsKey]])
    );
    applyTheme(s.themeMode || 'light', s.accentColor, opts);
  }
  function camelFromKey(f) {
    // maps settingsKey -> the applyTheme opts key it corresponds to
    const map = { customBgColor: 'bg', customModalBgColor: 'modalBg', customBtnColor: 'btnColor', customCapsuleColor: 'capsuleColor', customTitleColor: 'titleColor', customTextColor: 'textColor', customSubtextColor: 'subtextColor', customBottomBarColor: 'bottomBarColor' };
    return map[f.settingsKey] || f.settingsKey;
  }

  async function refreshAccentHistoryRow() {
    const s = await db.settings.get(1);
    const acc = s?.accentColor || DEFAULT_ACCENT;
    const hist = (s?.accentColorHistory || []).filter(c => c !== acc);
    document.getElementById('theme-history-row').innerHTML = hist.map(c => `<button class="theme-history-swatch" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
    wireHistorySwatches();
  }
  function wireHistorySwatches() {
    document.querySelectorAll('.theme-history-swatch').forEach(sw => {
      sw.addEventListener('click', async () => {
        await applyAccentChange(sw.dataset.color);
      });
    });
  }
  async function applyAccentChange(hex) {
    const s = await db.settings.get(1);
    const prevAccent = s?.accentColor || DEFAULT_ACCENT;
    let hist = s?.accentColorHistory || [];
    if (hex !== prevAccent && !hist.includes(prevAccent)) hist = [prevAccent, ...hist].slice(0, 6);
    await db.settings.update(1, { accentColor: hex, accentColorHistory: hist });
    await liveApply();
    await refreshAccentHistoryRow();
  }

  wireHslPicker('theme-accent', (hex) => applyAccentChange(hex));
  wireHistorySwatches();

  CUSTOM_COLOR_FIELDS.forEach(f => {
    wireHslPicker(`theme-${f.key}`, async (val) => { await saveField(f.settingsKey, val); await liveApply(); }, { withAlpha: f.withAlpha });
  });
  TILE_ACCENT_FIELDS.forEach(f => {
    wireHslPicker(`tile-${f.id}`, async (val) => { await saveField(f.settingsKey, val); await liveApply(); });
  });
  RING_COLOR_FIELDS.forEach(f => {
    wireHslPicker(`ring-${f.key}`, async (val) => { await saveField(f.settingsKey, val); await liveApply(); });
  });
  SEMANTIC_COLOR_FIELDS.forEach(f => {
    wireHslPicker(`sem-${f.key}`, async (val) => { await saveField(f.settingsKey, val); await liveApply(); });
  });

  // Layout sliders apply LIVE — watching the app resize under your finger is
  // the only way to find the size that's actually right for you.
  LAYOUT_FIELDS.forEach(f => {
    const el = document.getElementById(`layout-${f.key}`);
    const label = document.getElementById(`layout-${f.key}-val`);
    if (!el) return;
    ['click', 'pointerdown', 'touchstart', 'mousedown'].forEach(evt =>
      el.addEventListener(evt, (e) => e.stopPropagation()));
    el.addEventListener('input', async () => {
      label.textContent = `${toArabicNumeral(el.value)}${f.unit}`;
      document.documentElement.style.setProperty(f.cssVar, String(Number(el.value) / 100));
    });
    el.addEventListener('change', async () => {
      await saveField(f.settingsKey, Number(el.value));
    });
  });

  // Jump nav — the editor is long now.
  view.querySelectorAll('.settings-jump-chip').forEach(chip => {
    chip.addEventListener('click', () => safeScrollIntoView(document.getElementById(chip.dataset.jump)));
  });

  const restoreTop = document.getElementById('theme-restore-default');
  if (restoreTop) restoreTop.addEventListener('click', async () => {
    if (!confirm('استعادة المظهر الافتراضي بالكامل؟ (لن تُحذف مظاهرك المحفوظة)')) return;
    await restoreDefaultTheme();
    renderThemeEditorPage(params, view);
    toast('↺ عاد المظهر الافتراضي');
  });
  document.querySelectorAll('.theme-clear-btn').forEach(btn => {
    btn.addEventListener('click', async () => { await saveField(btn.dataset.clear, null); await liveApply(); toast('أُعيد للون الافتراضي'); });
  });

  const blurInput = document.getElementById('theme-blur-input');
  blurInput.addEventListener('click', (e) => e.stopPropagation());
  blurInput.addEventListener('input', async () => { await saveField('customBlurAmount', Number(blurInput.value)); await liveApply(); });

  const saveBtn = document.getElementById('theme-save-preset-btn');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const name = document.getElementById('theme-preset-name-input').value.trim();
    if (!name) return;
    const ok = await saveCustomPreset(name);
    if (ok) { toast('🎨 تم حفظ المظهر'); renderThemeEditorPage(params, view); }
  });
  document.querySelectorAll('.theme-preset-apply').forEach(btn => {
    btn.addEventListener('click', async () => { await applyCustomPreset(Number(btn.dataset.id)); renderThemeEditorPage(params, view); });
  });
  document.querySelectorAll('.theme-preset-update').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('تحديث هذا المظهر المحفوظ ليطابق الإعدادات الحالية؟')) return;
      await updateCustomPresetToCurrent(Number(btn.dataset.id));
      toast('تم التحديث');
    });
  });
  document.querySelectorAll('.theme-preset-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('حذف هذا المظهر المحفوظ؟')) return;
      await deleteCustomPreset(Number(btn.dataset.id));
      renderThemeEditorPage(params, view);
    });
  });

  document.getElementById('theme-restore-default').addEventListener('click', async () => {
    if (!confirm('استعادة المظهر الافتراضي (فاتح، اللون الوردي الأصلي، بلا ألوان مخصصة)؟')) return;
    await restoreDefaultTheme(); // one definition, shared with the Settings shortcut
    renderThemeEditorPage(params, view);
  });
}
