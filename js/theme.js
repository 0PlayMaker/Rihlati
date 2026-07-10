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

function hslPickerHtml(idPrefix, currentHex) {
  const rgb = hexToRgb(currentHex);
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return `
    <div class="hsl-picker" id="${idPrefix}-picker">
      <div class="hsl-swatch" id="${idPrefix}-swatch" style="background:${currentHex}"></div>
      <div class="hsl-sliders">
        <div class="hsl-slider-row"><label for="${idPrefix}-hue">الصبغة</label><input type="range" min="0" max="360" value="${Math.round(h)}" id="${idPrefix}-hue" class="hsl-slider hsl-slider-hue"></div>
        <div class="hsl-slider-row"><label for="${idPrefix}-sat">التشبّع</label><input type="range" min="0" max="100" value="${Math.round(s)}" id="${idPrefix}-sat" class="hsl-slider"></div>
        <div class="hsl-slider-row"><label for="${idPrefix}-light">السطوع</label><input type="range" min="0" max="100" value="${Math.round(l)}" id="${idPrefix}-light" class="hsl-slider"></div>
      </div>
      <input type="text" class="text-input theme-hex-input" id="${idPrefix}-hex" value="${currentHex}" maxlength="7">
    </div>`;
}

function wireHslPicker(idPrefix, onChange) {
  const hueInput = document.getElementById(`${idPrefix}-hue`);
  const satInput = document.getElementById(`${idPrefix}-sat`);
  const lightInput = document.getElementById(`${idPrefix}-light`);
  const hexInput = document.getElementById(`${idPrefix}-hex`);
  const swatch = document.getElementById(`${idPrefix}-swatch`);

  // Belt-and-suspenders: sliders live inside a collapsible <details>,
  // and dragging them was somehow toggling it closed — stop every
  // interaction from bubbling at all, regardless of the exact browser
  // mechanism responsible.
  [hueInput, satInput, lightInput].forEach(input => {
    ['click', 'pointerdown', 'touchstart', 'mousedown'].forEach(evt => {
      input.addEventListener(evt, (e) => e.stopPropagation());
    });
  });

  function fromSliders() {
    const rgb = hslToRgb(Number(hueInput.value), Number(satInput.value), Number(lightInput.value));
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    swatch.style.background = hex;
    hexInput.value = hex;
    return hex;
  }
  [hueInput, satInput, lightInput].forEach(input => {
    input.addEventListener('input', () => onChange(fromSliders()));
  });
  hexInput.addEventListener('change', () => {
    const val = hexInput.value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
    const rgb = hexToRgb(val);
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    hueInput.value = Math.round(h);
    satInput.value = Math.round(s);
    lightInput.value = Math.round(l);
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

  // Custom overrides layer on top of whatever the mode set — a plain
  // hex from her own picker, not derived/tinted like the accent, since
  // these don't need light+deep variants the way a single accent
  // choice does.
  if (opts.bg) root.setProperty('--bg', opts.bg);
  if (opts.modalBg) root.setProperty('--modal-bg', opts.modalBg);
  if (opts.textColor) root.setProperty('--ink', opts.textColor);
  if (opts.subtextColor) root.setProperty('--ink-soft', opts.subtextColor);
  root.setProperty('--title-color', opts.titleColor || 'var(--ink)');

  // Buttons default to the accent's deep shade (same as before this
  // was customizable); capsules get their own color, defaulting to
  // the same, with an rgb triplet for the glow.
  const btnHex = opts.btnColor || deep;
  root.setProperty('--btn-color', btnHex);
  const capsuleHex = opts.capsuleColor || deep;
  root.setProperty('--capsule-color', capsuleHex);
  const cr = hexToRgb(capsuleHex);
  root.setProperty('--capsule-color-rgb', `${cr.r}, ${cr.g}, ${cr.b}`);

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
    subtextColor: settings?.customSubtextColor
  });
}

// Everything except accent (which has history + derives light/deep
// shades) follows this same shape: a plain color, defaulting to the
// mode's own value unless she's overridden it, with a "use default"
// clear button. Looping over this list is what keeps 7 near-identical
// color pickers from being 7 copies of the same markup+wiring.
const CUSTOM_COLOR_FIELDS = [
  { key: 'bg', settingsKey: 'customBgColor', label: 'لون الخلفية', fallback: () => document.documentElement.style.getPropertyValue('--bg') || '#FFF9F5' },
  { key: 'modalbg', settingsKey: 'customModalBgColor', label: 'لون النوافذ المنبثقة', fallback: () => document.documentElement.style.getPropertyValue('--modal-bg') || '#FFFFFF' },
  { key: 'btn', settingsKey: 'customBtnColor', label: 'لون الأزرار', fallback: () => DEFAULT_ACCENT },
  { key: 'capsule', settingsKey: 'customCapsuleColor', label: 'لون الكبسولات (مثل زر الهدف)', fallback: () => DEFAULT_ACCENT },
  { key: 'title', settingsKey: 'customTitleColor', label: 'لون العناوين', fallback: () => '#4A4152' },
  { key: 'text', settingsKey: 'customTextColor', label: 'لون النص', fallback: () => '#4A4152' },
  { key: 'subtext', settingsKey: 'customSubtextColor', label: 'لون النص الفرعي', fallback: () => '#8B8394' }
];

// ---------- Settings UI ----------

function renderThemeSection(currentMode, currentAccent, accentHistory, customColors) {
  const history = (accentHistory || []).filter(c => c !== (currentAccent || DEFAULT_ACCENT));
  const cc = customColors || {};
  return `
    <div class="card settings-card">
      <h2 class="card-title">المظهر</h2>
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
          <button class="capsule-btn theme-preview-capsule">كبسولة</button>
        </div>
      </div>

      <details class="weight-history-details">
        <summary>تخصيص الألوان</summary>

        <label class="field-label">لون التمييز</label>
        ${hslPickerHtml('theme-accent', currentAccent || DEFAULT_ACCENT)}
        ${history.length ? `
          <div class="theme-history-row" id="theme-history-row">
            ${history.map(c => `<button class="theme-history-swatch" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
          </div>` : ''}

        ${CUSTOM_COLOR_FIELDS.map(f => `
          <label class="field-label">${f.label} (اختياري)</label>
          ${hslPickerHtml(`theme-${f.key}`, cc[f.settingsKey] || f.fallback())}
          <button class="btn btn-text btn-sm theme-clear-btn" data-clear="${f.settingsKey}">استخدام اللون الافتراضي</button>
        `).join('')}

        <button class="link-btn" id="theme-restore-default">استعادة المظهر الافتراضي بالكامل</button>
      </details>
    </div>`;
}

function wireThemeSection(view) {
  const modeChips = document.getElementById('theme-mode-chips');
  let selectedMode = modeChips.querySelector('.chip.active')?.dataset.mode || 'light';

  async function saveAndApply(overrides = {}) {
    const settings = await db.settings.get(1);
    const prevAccent = settings?.accentColor || DEFAULT_ACCENT;
    const newAccent = overrides.accentColor;
    let history = settings?.accentColorHistory || [];
    if (newAccent && newAccent !== prevAccent && !history.includes(prevAccent)) {
      history = [prevAccent, ...history].slice(0, 6);
    }
    const toSave = { themeMode: selectedMode, accentColor: newAccent || prevAccent, accentColorHistory: history };
    CUSTOM_COLOR_FIELDS.forEach(f => {
      toSave[f.settingsKey] = f.settingsKey in overrides ? overrides[f.settingsKey] : settings?.[f.settingsKey];
    });
    await db.settings.update(1, toSave);
    applyTheme(selectedMode, toSave.accentColor, {
      bg: toSave.customBgColor, modalBg: toSave.customModalBgColor, btnColor: toSave.customBtnColor,
      capsuleColor: toSave.customCapsuleColor, titleColor: toSave.customTitleColor,
      textColor: toSave.customTextColor, subtextColor: toSave.customSubtextColor
    });
    if (newAccent) renderSettingsPage([], view); // refresh so the history row reflects the new state
  }

  wireHslPicker('theme-accent', (hex) => saveAndApply({ accentColor: hex }));
  const historyRow = document.getElementById('theme-history-row');
  if (historyRow) historyRow.querySelectorAll('.theme-history-swatch').forEach(sw => {
    sw.addEventListener('click', () => saveAndApply({ accentColor: sw.dataset.color }));
  });
  modeChips.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedMode = chip.dataset.mode;
      modeChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
      saveAndApply();
    });
  });

  CUSTOM_COLOR_FIELDS.forEach(f => {
    wireHslPicker(`theme-${f.key}`, (hex) => saveAndApply({ [f.settingsKey]: hex }));
  });
  document.querySelectorAll('.theme-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => saveAndApply({ [btn.dataset.clear]: null }));
  });

  document.getElementById('theme-restore-default').addEventListener('click', async () => {
    if (!confirm('استعادة المظهر الافتراضي (فاتح، اللون الوردي الأصلي، بلا ألوان مخصصة)؟')) return;
    selectedMode = 'light';
    const reset = { themeMode: 'light', accentColor: DEFAULT_ACCENT };
    CUSTOM_COLOR_FIELDS.forEach(f => { reset[f.settingsKey] = null; });
    await db.settings.update(1, reset);
    applyTheme('light', DEFAULT_ACCENT, {});
    renderSettingsPage([], view);
  });
}
