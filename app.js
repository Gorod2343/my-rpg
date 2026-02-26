const TG = window.Telegram.WebApp;

// === ИНИЦИАЛИЗАЦИЯ ПО ДОКАМ (максимально рано) ===
TG.ready();
TG.expand();
TG.enableClosingConfirmation(true);
TG.setHeaderColor('#0c1017');
TG.setBackgroundColor('#0c1017');
TG.setBottomBarColor('#161b22');

let isLocked = false;
let lastLoadTime = 0;
let cachedData = null;
let currentTab = 'path';
let sleepStart = null;

const root = document.getElementById('root');

function createEl(tag, classes = '', text = '') {
    const el = document.createElement(tag);
    if (classes) el.className = classes;
    if (text) el.textContent = text;
    return el;
}

// === ДИНАМИЧЕСКАЯ ТЕМА (по docs) ===
function applyTheme() {
    const params = TG.themeParams;
    document.documentElement.style.setProperty('--tg-bg-color', params.bg_color || '#0c1017');
    document.documentElement.style.setProperty('--tg-text-color', params.text_color || '#ffffff');
    document.documentElement.style.setProperty('--tg-button-color', params.button_color || '#4f46e5');
    document.body.style.backgroundColor = params.bg_color || '#0c1017';
}
TG.onEvent('themeChanged', applyTheme);
applyTheme();

// Debounce
function debounceAction(fn) {
    return async () => {
        if (isLocked) return;
        isLocked = true;
        try { await fn(); } finally { setTimeout(() => isLocked = false, 350); }
    };
}

async function apiPost(endpoint, extraBody = {}) {
    const body = { init_data: TG.initData, ...extraBody };
    const res = await fetch(`/api${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

async function loadHero(force = false) {
    if (!force && Date.now() - lastLoadTime < 10000) return cachedData;
    try {
        const data = await apiPost('/load-profile');
        cachedData = data;
        lastLoadTime = Date.now();
        sleepStart = data.user.sleep_start;
        renderAll();
        return data;
    } catch (e) {
        showSplash('Ошибка загрузки. Проверьте сеть.');
    }
}

// === SPLASH БЕЗ innerHTML (чистый DOM) ===
function showSplash(msg) {
    const splash = createEl('div', 'fixed inset-0 bg-[#0c1017] flex flex-col items-center justify-center z-50');
    
    const text = createEl('div', 'text-2xl mb-8 text-center px-6', msg);
    const btn = createEl('button', 'px-10 py-4 bg-indigo-600 rounded-3xl text-lg font-semibold', 'Перезагрузить');
    btn.addEventListener('click', () => location.reload());
    
    splash.append(text, btn);
    root.appendChild(splash);
}

// Остальные функции renderHeader, buildWaterCard, buildSleepCard, buildAccordions, renderPath и т.д. — остались прежними (все на createElement)

function renderAll() {
    root.innerHTML = ''; // только один innerHTML для полного перерендера — разрешено
    // ... (весь рендер как раньше)
}

async function init() {
    TG.MainButton.hide();
    await loadHero(true);
    setInterval(() => loadHero(), 30000);
}

window.onload = init;
