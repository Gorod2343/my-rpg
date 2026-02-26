// ---------------------------------------------------------------------------
// Инициализация Telegram WebApp и базовые настройки
// ---------------------------------------------------------------------------
const tg = window.Telegram.WebApp;
tg.expand();

// Укажи здесь URL своего сервера на Render
const backendUrl = "https://rpg-backend-yg16.onrender.com";
const initData = tg.initData || ""; 
const reqHeaders = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': initData // Передаем подпись для проверки на бэкенде
};

// Данные пользователя
const userId = tg.initDataUnsafe?.user?.id?.toString() || "guest_123";
const firstName = tg.initDataUnsafe?.user?.first_name || "Герой";

// Глобальные переменные состояния
let currentHabits = [];
let completedTasksArray = [];
let editingId = null;
let shopState = {};
let isLocked = false;
let lastHeroLoadTime = 0;
const CACHE_TTL = 10000; // 10 секунд кеша для вкладок

// Дефолтные привычки (если пользователь еще не создал свои)
const defaultHabits = [
    { id: 'task-run', cat: 'sport', name: 'Пробежка', xp: 150 },
    { id: 'task-strength', cat: 'sport', name: 'Силовая тренировка', xp: 200 },
    { id: 'task-family', cat: 'family', name: 'Время с семьей', xp: 100 }
];

// Награды для магазина
const rewards = [
    { id: 'baton', name: 'Батончик', cost: 100, icon: '🍫' },
    { id: 'soda', name: 'Газировка', cost: 150, icon: '🥤' },
    { id: 'fast', name: 'Фаст Фуд', cost: 600, icon: '🍔' }
];

// Инициализация состояния магазина
rewards.forEach(r => shopState[r.id] = 1);

// ---------------------------------------------------------------------------
// Утилиты безопасности
// ---------------------------------------------------------------------------

// Функция для безопасного создания элементов (Защита от XSS)
function el(tag, className, textContent) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (textContent !== undefined && textContent !== null) e.textContent = textContent;
    return e;
}

// ---------------------------------------------------------------------------
// Сетевые запросы к Backend
// ---------------------------------------------------------------------------
async function apiCall(endpoint, method = 'GET', payload = null) {
    const options = { method, headers: reqHeaders };
    if (payload) {
        options.body = JSON.stringify(payload);
    }
    const r = await fetch(`${backendUrl}${endpoint}`, options);
    
    if (!r.ok) {
        if (r.status === 401) throw new Error("Ошибка авторизации. Запустите через Telegram.");
        if (r.status === 429) throw new Error("Слишком много запросов. Подождите.");
        throw new Error(`Ошибка сервера (${r.status})`);
    }
    return await r.json();
}

// ---------------------------------------------------------------------------
// Рендеринг интерфейса
// ---------------------------------------------------------------------------
function updateUI(d) {
    if (!d) return;
    
    // Обновление статистики
    document.getElementById('total-xp').textContent = d.total_xp || 0;
    document.getElementById('month-xp').textContent = d.current_month_xp || 0;
    document.getElementById('shop-balance').textContent = (d.current_month_xp || 0) + " XP";
    document.getElementById('user-hp').textContent = d.hp || 100;
    document.getElementById('hp-bar').style.width = (d.hp || 100) + '%';
    document.getElementById('water-text').textContent = `${d.water_count || 0} / ${d.water_goal || 8}`;
    
    // Обновление кнопки сна
    const sB = document.getElementById('btn-toggle-sleep');
    const sI = document.getElementById('sleep-icon');
    const sT = document.getElementById('sleep-btn-text');
    const sS = document.getElementById('sleep-status');
    
    if (d.sleep_start) {
        sB.classList.add('sleep-active'); 
        sI.textContent = '☀️'; 
        sT.textContent = 'Проснуться';
        const dt = new Date(d.sleep_start + (!d.sleep_start.includes('Z') ? 'Z' : '')); 
        sS.textContent = `C ${dt.getHours()}:${dt.getMinutes().toString().padStart(2, '0')}`;
        sS.classList.replace('text-gray-500', 'text-indigo-400');
    } else {
        sB.classList.remove('sleep-active'); 
        sI.textContent = '🌙'; 
        sT.textContent = 'Уснуть'; 
        sS.textContent = 'OFF';
        sS.classList.replace('text-indigo-400', 'text-gray-500');
    }

    // Рендер истории
    if (d.history) renderHistory(d.history);
    
    // Рендер магазина
    renderShop();

    // Загрузка привычек
    completedTasksArray = d.completed_tasks ? d.completed_tasks.split(',') : [];
    if (d.custom_habits) {
        try {
            const parsed = JSON.parse(d.custom_habits);
            currentHabits = Array.isArray(parsed) && parsed.length > 0 ? parsed : JSON.parse(JSON.stringify(defaultHabits));
        } catch(e) { 
            currentHabits = JSON.parse(JSON.stringify(defaultHabits)); 
        }
    } else {
        currentHabits = JSON.parse(JSON.stringify(defaultHabits));
    }
    
    renderHabits();
    
    // Скрытие загрузочного экрана
    const splash = document.getElementById('splash-screen');
    if (splash && splash.style.display !== 'none') {
        splash.style.opacity = '0';
        setTimeout(() => splash.style.display = 'none', 500);
    }
}

function renderHistory(historyData) {
    const list = document.getElementById('history-list');
    list.textContent = ''; 
    
    historyData.forEach(h => {
        const card = el('div', 'prosto-card p-4 flex justify-between items-center mb-2');
        const leftDiv = el('div', 'flex-1 pr-4');
        const title = el('div', 'text-sm font-bold text-white mb-1 leading-tight', h.desc);
        
        const hd = new Date(h.time);
        const timeStr = isNaN(hd.getTime()) ? "" : `${String(hd.getHours()).padStart(2, '0')}:${String(hd.getMinutes()).padStart(2, '0')}`;
        const timeDiv = el('div', 'text-[10px] text-gray-500 uppercase tracking-wider', timeStr);
        
        leftDiv.appendChild(title);
        leftDiv.appendChild(timeDiv);
        
        const rightDiv = el('div', `font-bold text-base whitespace-nowrap ${h.type === 'gain' ? 'text-blue-400' : 'text-red-400'}`, `${h.type === 'gain' ? '+' : '-'}${h.amt} XP`);
        card.appendChild(leftDiv);
        card.appendChild(rightDiv);
        list.appendChild(card);
    });
}

function renderHabits() {
    const s = document.getElementById('list-sport');
    const f = document.getElementById('list-family');
    const eList = document.getElementById('editor-list');
    
    s.textContent = ''; 
    f.textContent = ''; 
    eList.textContent = '';
    
    currentHabits.forEach(h => {
        const isDone = completedTasksArray.includes(h.id);
        
        // Кнопка на главном экране
        const btn = el('button', `w-full text-left flex items-center gap-4 p-4 rounded-xl transition-colors ${isDone ? 'done-task' : 'hover:bg-white/5'}`);
        if(isDone) btn.disabled = true;
        
        const circle = el('div', `w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] ${isDone ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-600'}`, isDone ? '✓' : '');
        const nameDiv = el('div', 'flex-1 font-bold text-sm text-white', h.name);
        const xpDiv = el('div', 'text-blue-400 font-black text-xs', `+${h.xp}`);
        
        btn.appendChild(circle); 
        btn.appendChild(nameDiv); 
        btn.appendChild(xpDiv);
        btn.addEventListener('click', () => completeTask(h, btn));
            
        if (h.cat === 'sport') {
            s.appendChild(btn);
        } else {
            f.appendChild(btn);
        }
        
        // Рендер в редакторе
        const card = el('div', 'prosto-card p-3 flex justify-between items-center mb-2 border border-gray-800');
        const cName = el('div', 'text-sm font-bold text-white', h.name + " ");
        const cXp = el('span', 'text-blue-400 text-xs ml-1', `+${h.xp}`);
        cName.appendChild(cXp);
        
        const btnGroup = el('div', 'flex gap-2');
        const eBtn = el('button', 'px-2 py-1 bg-blue-600/20 text-blue-400 rounded text-[10px] font-black uppercase', 'Изм.');
        eBtn.addEventListener('click', () => editHabit(h.id));
        
        const dBtn = el('button', 'px-2 py-1 bg-red-600/20 text-red-500 rounded text-[10px] font-black uppercase', 'Удал.');
        dBtn.addEventListener('click', () => removeHabit(h.id));
        
        btnGroup.appendChild(eBtn); 
        btnGroup.appendChild(dBtn);
        card.appendChild(cName); 
        card.appendChild(btnGroup);
        eList.appendChild(card);
    });

    // Пересчет высоты аккордеона
    document.querySelectorAll('.accordion-content').forEach(el => {
        if (el.style.maxHeight && el.style.maxHeight !== '0px') {
            el.style.maxHeight = el.scrollHeight + 'px';
        }
    });
}

function renderShop() {
    const container = document.getElementById('shop-items');
    container.textContent = '';
    
    rewards.forEach(r => {
        const card = el('div', 'prosto-card p-4');
        const topFlex = el('div', 'flex items-center gap-4 mb-4');
        const iconDiv = el('div', 'w-12 h-12 rounded-2xl bg-[#0c1017] border border-gray-800 flex items-center justify-center text-2xl', r.icon);
        const nameGroup = el('div', 'flex-1');
        nameGroup.appendChild(el('div', 'font-bold text-white text-sm', r.name));
        nameGroup.appendChild(el('div', 'text-blue-400 font-bold text-xs mt-0.5', `${r.cost} XP / шт`));
        topFlex.appendChild(iconDiv); 
        topFlex.appendChild(nameGroup);
        
        const botFlex = el('div', 'flex items-center gap-3');
        const counter = el('div', 'flex items-center bg-[#0c1017] border border-gray-800 rounded-xl p-1');
        
        const btnM = el('button', 'w-10 h-10 font-bold text-gray-400', '-');
        btnM.addEventListener('click', () => changeQty(r.id, -1));
        
        const spanQ = el('span', 'w-8 text-center text-sm font-bold text-white', shopState[r.id]);
        spanQ.id = `qty-${r.id}`;
        
        const btnP = el('button', 'w-10 h-10 font-bold text-gray-400', '+');
        btnP.addEventListener('click', () => changeQty(r.id, 1));
        
        counter.appendChild(btnM); 
        counter.appendChild(spanQ); 
        counter.appendChild(btnP);
        
        const buyBtn = el('button', 'flex-1 prosto-btn py-3.5 px-2 font-bold text-[11px] uppercase tracking-wider', `Забрать за ${r.cost * shopState[r.id]}`);
        buyBtn.id = `buy-btn-${r.id}`;
        buyBtn.addEventListener('click', () => buyReward(r.id));
        
        botFlex.appendChild(counter); 
        botFlex.appendChild(buyBtn);
        card.appendChild(topFlex); 
        card.appendChild(botFlex);
        container.appendChild(card);
    });
}

function changeQty(id, delta) {
    shopState[id] = Math.max(1, shopState[id] + delta);
    const r = rewards.find(i => i.id === id);
    document.getElementById(`qty-${id}`).textContent = shopState[id];
    document.getElementById(`buy-btn-${id}`).textContent = `Забрать за ${r.cost * shopState[id]}`;
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

// ---------------------------------------------------------------------------
// Логика взаимодействия с API
// ---------------------------------------------------------------------------
async function loadHero(forceUpdate = false) {
    if (!forceUpdate && (Date.now() - lastHeroLoadTime < CACHE_TTL)) return;
    
    try {
        const data = await apiCall(`/get_hero/${userId}`);
        updateUI(data);
        lastHeroLoadTime = Date.now();
    } catch(e) {
        const st = document.getElementById('splash-text');
        const sr = document.getElementById('btn-splash-reload');
        if(st && sr) { 
            st.textContent = e.message; 
            st.classList.replace('text-blue-500', 'text-red-500'); 
            st.classList.remove('animate-pulse'); 
            sr.classList.remove('hidden'); 
        }
    }
}

async function completeTask(habit, btn) {
    if(isLocked) return; 
    isLocked = true;
    btn.classList.add('btn-loading');
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
    
    try {
        const safeName = encodeURIComponent(habit.name);
        const data = await apiCall(`/add_xp/${userId}?amount=${habit.xp}&task_id=${habit.id}&task_name=${safeName}`, 'POST');
        updateUI(data);
    } catch (e) { 
        tg.showAlert(e.message); 
    } finally { 
        btn.classList.remove('btn-loading'); 
        isLocked = false; 
    }
}

async function buyReward(rewardId) {
    if(isLocked) return; 
    isLocked = true;
    const btn = document.getElementById(`buy-btn-${rewardId}`);
    const r = rewards.find(i => i.id === rewardId);
    btn.classList.add('btn-loading');
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
    
    try {
        const safeName = encodeURIComponent(r.name);
        const data = await apiCall(`/buy_reward/${userId}?cost=${r.cost}&name=${safeName}&qty=${shopState[rewardId]}`, 'POST');
        if(data.error) {
            tg.showAlert(data.error);
        } else { 
            updateUI(data); 
            shopState[rewardId] = 1; 
            renderShop(); 
        }
    } catch (e) { 
        tg.showAlert(e.message); 
    } finally { 
        btn.classList.remove('btn-loading'); 
        isLocked = false; 
    }
}

async function drinkWater() {
    if(isLocked) return; 
    isLocked = true;
    const btn = document.getElementById('btn-drink-water'); 
    btn.classList.add('btn-loading');
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    
    try { 
        const data = await apiCall(`/drink_water/${userId}`, 'POST'); 
        updateUI(data); 
    } catch (e) { 
        tg.showAlert(e.message); 
    } finally { 
        btn.classList.remove('btn-loading'); 
        isLocked = false; 
    }
}

async function toggleSleep() {
    if(isLocked) return; 
    isLocked = true;
    const btn = document.getElementById('btn-toggle-sleep'); 
    btn.classList.add('btn-loading');
    
    try {
        const tz = new Date().getTimezoneOffset();
        const data = await apiCall(`/sleep_action/${userId}?tz=${tz}`, 'POST');
        updateUI(data);
        if(data.sleep_report) tg.showAlert(data.sleep_report);
    } catch (e) { 
        tg.showAlert(e.message); 
    } finally { 
        btn.classList.remove('btn-loading'); 
        isLocked = false; 
    }
}

async function applyWaterGoal() {
    if(isLocked) return; 
    isLocked = true;
    const btn = document.getElementById('btn-apply-calc');
    const w = document.getElementById('calc-weight').value;
    const a = document.getElementById('calc-activity').value;
    
    if(w > 0) {
        btn.classList.add('btn-loading');
        const g = Math.ceil((w * a) / 250);
        try {
            const data = await apiCall(`/set_water_goal/${userId}?goal=${g}`, 'POST');
            updateUI(data);
            const resBox = document.getElementById('bmi-res');
            resBox.classList.remove('hidden');
            resBox.textContent = `Ваша дневная норма: ${g} ст.`;
        } catch (e) { 
            tg.showAlert(e
