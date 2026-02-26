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
    'X-Telegram-Init-Data': initData 
};

// Данные пользователя
const userId = tg.initDataUnsafe?.user?.id?.toString() || "guest_123";
const firstName = tg.initDataUnsafe?.user?.first_name || "Герой";

// Глобальные переменные состояния
let currentHabits = [];
let serverTasks = [];
let serverRewards = [];
let completedTasksArray = [];
let editingId = null;
let shopState = {};
let isLocked = false;
let lastHeroLoadTime = 0;
const CACHE_TTL = 10000;

const defaultHabits = [
    { id: 'task-run', cat: 'sport', name: 'Пробежка', xp: 150 },
    { id: 'task-strength', cat: 'sport', name: 'Силовая тренировка', xp: 200 },
    { id: 'task-family', cat: 'family', name: 'Время с семьей', xp: 100 }
];

// ---------------------------------------------------------------------------
// Утилиты безопасности
// ---------------------------------------------------------------------------
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
    
    document.getElementById('total-xp').textContent = d.total_xp || 0;
    document.getElementById('month-xp').textContent = d.current_month_xp || 0;
    document.getElementById('shop-balance').textContent = (d.current_month_xp || 0) + " XP";
    document.getElementById('user-hp').textContent = d.hp || 100;
    document.getElementById('hp-bar').style.width = (d.hp || 100) + '%';
    document.getElementById('water-text').textContent = `${d.water_count || 0} / ${d.water_goal || 8}`;
    
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

    if (d.history) renderHistory(d.history);
    
    if (d.tasks) serverTasks = d.tasks;
    if (d.rewards) {
        serverRewards = d.rewards;
        serverRewards.forEach(r => { if(!shopState[r.id]) shopState[r.id] = 1; });
        renderShop();
    }

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
    
    const allTasks = [...serverTasks, ...currentHabits];
    
    allTasks.forEach(h => {
        const isDone = completedTasksArray.includes(h.id);
        
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
        
        if (h.id.startsWith('task-custom')) {
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
        }
    });

    document.querySelectorAll('.accordion-content').forEach(el => {
        if (el.style.maxHeight && el.style.maxHeight !== '0px') {
            el.style.maxHeight = el.scrollHeight + 'px';
        }
    });
}

function renderShop() {
    const container = document.getElementById('shop-items');
    container.textContent = '';
    
    serverRewards.forEach(r => {
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
    const r = serverRewards.find(i => i.id === id);
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
        const data = await apiCall(`/hero`);
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
        const data = await apiCall(`/tasks/complete`, 'POST', { task_id: habit.id });
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
    btn.classList.add('btn-loading');
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
    
    try {
        const data = await apiCall(`/rewards/buy`, 'POST', { reward_id: rewardId, qty: shopState[rewardId] });
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
        const data = await apiCall(`/health/drink`, 'POST'); 
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
        const data = await apiCall(`/sleep/action`, 'POST', { tz: tz });
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
            const data = await apiCall(`/health/set-goal`, 'POST', { goal: g });
            updateUI(data);
            const resBox = document.getElementById('bmi-res');
            resBox.classList.remove('hidden');
            resBox.textContent = `Ваша дневная норма: ${g} ст.`;
        } catch (e) { 
            tg.showAlert(e.message); 
        } finally { 
            btn.classList.remove('btn-loading'); 
            isLocked = false; 
        }
    } else { 
        isLocked = false; 
        tg.showAlert("Введите вес!");
    }
}

async function saveHabitsToServer() {
    if(isLocked) return; 
    isLocked = true;
    const btn = document.getElementById('btn-save-habits'); 
    btn.classList.add('btn-loading');
    
    try {
        const data = await apiCall(`/habits/update`, 'POST', { habits: JSON.stringify(currentHabits) });
        updateUI(data);
        closeEditor();
    } catch (e) { 
        tg.showAlert(e.message); 
    } finally { 
        btn.classList.remove('btn-loading'); 
        isLocked = false; 
    }
}

// ---------------------------------------------------------------------------
// Логика Редактора
// ---------------------------------------------------------------------------
function editHabit(id) {
    const h = currentHabits.find(x => x.id === id);
    if(h) { 
        document.getElementById('new-h-name').value = h.name; 
        document.getElementById('new-h-cat').value = h.cat; 
        document.getElementById('new-h-xp').value = h.xp; 
        editingId = id; 
        document.getElementById('btn-add-habit').textContent = 'Обновить'; 
    }
}

function addNewHabit() {
    const n = document.getElementById('new-h-name').value.trim();
    const c = document.getElementById('new-h-cat').value;
    const x = Math.max(1, parseInt(document.getElementById('new-h-xp').value) || 0);
    
    if(n && x > 0) {
        if(editingId) {
            const i = currentHabits.findIndex(h => h.id === editingId);
            currentHabits[i] = {...currentHabits[i], name: n, cat: c, xp: x}; 
            editingId = null; 
            document.getElementById('btn-add-habit').textContent = 'Добавить в список';
        } else { 
            currentHabits.push({id: 'task-custom-' + Date.now(), cat: c, name: n, xp: x}); 
        }
        document.getElementById('new-h-name').value = ''; 
        document.getElementById('new-h-xp').value = ''; 
        renderHabits();
    } else {
        tg.showAlert("Заполните корректно название и XP");
    }
}

function removeHabit(id) { 
    currentHabits = currentHabits.filter(h => h.id !== id); 
    renderHabits(); 
}

// ---------------------------------------------------------------------------
// Логика UI
// ---------------------------------------------------------------------------
function showTab(n) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    document.getElementById('tab-' + n).classList.remove('hidden');
    
    document.querySelectorAll('nav button').forEach(b => {
        b.classList.remove('nav-active', 'bg-white/5');
        b.classList.add('text-gray-500');
    });
    
    const activeBtn = document.getElementById('nav-' + n);
    activeBtn.classList.add('nav-active', 'bg-white/5');
    activeBtn.classList.remove('text-gray-500');
    
    if(n === 'tasks' || n === 'history') loadHero(false); 
}

function toggleAccordion(c, i) {
    const el = document.getElementById(c);
    const ic = document.getElementById(i);
    const isOpen = el.style.maxHeight && el.style.maxHeight !== '0px';
    
    document.querySelectorAll('.accordion-content').forEach(a => a.style.maxHeight = '0px');
    document.querySelectorAll('.chevron').forEach(a => a.classList.remove('rotate-180'));
    
    if(!isOpen) { 
        el.style.maxHeight = el.scrollHeight + "px"; 
        ic.classList.add('rotate-180'); 
    }
}

function openEditor() { document.getElementById('editor-modal').classList.add('active'); }
function closeEditor() { document.getElementById('editor-modal').classList.remove('active'); }

// ---------------------------------------------------------------------------
// Подключение событий при загрузке DOM
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('user-name').textContent = firstName;
    document.getElementById('avatar-container').textContent = firstName[0] ? firstName[0].toUpperCase() : '?';
    
    // События
    document.getElementById('btn-splash-reload').addEventListener('click', () => location.reload());
    document.getElementById('avatar-container').addEventListener('click', () => loadHero(true));
    document.getElementById('btn-drink-water').addEventListener('click', drinkWater);
    document.getElementById('btn-toggle-sleep').addEventListener('click', toggleSleep);
    document.getElementById('btn-acc-sport').addEventListener('click', () => toggleAccordion('acc-sport', 'icon-sport'));
    document.getElementById('btn-acc-family').addEventListener('click', () => toggleAccordion('acc-family', 'icon-family'));
    document.getElementById('btn-open-editor').addEventListener('click', openEditor);
    document.getElementById('btn-close-editor').addEventListener('click', closeEditor);
    document.getElementById('btn-apply-calc').addEventListener('click', applyWaterGoal);
    document.getElementById('btn-add-habit').addEventListener('click', addNewHabit);
    document.getElementById('btn-save-habits').addEventListener('click', saveHabitsToServer);
    
    // Навигация
    document.getElementById('nav-tasks').addEventListener('click', () => showTab('tasks'));
    document.getElementById('nav-calc').addEventListener('click', () => showTab('calc'));
    document.getElementById('nav-shop').addEventListener('click', () => showTab('shop'));
    document.getElementById('nav-history').addEventListener('click', () => showTab('history'));

    // Первый запуск
    loadHero(true);
});
