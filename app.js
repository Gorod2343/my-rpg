/**
 * Life RPG — Telegram WebApp Client
 * Security: No innerHTML, DOM Builder pattern, global debounce lock, XSS-safe
 */
(function () {
  "use strict";

  // ─────────────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────────────
  const API_BASE = "";  // same-origin; set to backend URL if separate
  const HERO_CACHE_TTL = 10000; // 10 seconds

  const ACTIVITY_OPTIONS = [
    { value: 1.0, label: "🪑 Сидячий", sub: "×1.0" },
    { value: 1.375, label: "🚶 Лёгкий", sub: "×1.375" },
    { value: 1.55, label: "🏃 Умеренный", sub: "×1.55" },
    { value: 1.725, label: "💪 Высокий", sub: "×1.725" },
  ];

  const EVENT_ICONS = {
    water: "💧",
    sleep: "😴",
    task: "✅",
    shop: "🛒",
    penalty: "⚠️",
  };

  // ─────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────
  let heroData = null;
  let heroLastFetch = 0;
  let isLocked = false;
  let initData = "";
  let sleepTimerInterval = null;
  let selectedActivityFactor = 1.0;
  let currentTab = "path";

  // ─────────────────────────────────────────────
  // TELEGRAM SDK
  // ─────────────────────────────────────────────
  function getTg() {
    return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  }

  // ─────────────────────────────────────────────
  // SECURE DOM BUILDER — no innerHTML allowed
  // ─────────────────────────────────────────────
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className") node.className = v;
        else if (k === "textContent") node.textContent = v;
        else if (k === "style") Object.assign(node.style, v);
        else if (k.startsWith("data-")) node.setAttribute(k, v);
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      for (const child of children) {
        if (!child) continue;
        if (typeof child === "string") node.appendChild(document.createTextNode(child));
        else node.appendChild(child);
      }
    }
    return node;
  }

  function clearEl(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ─────────────────────────────────────────────
  // TOAST
  // ─────────────────────────────────────────────
  function showToast(msg, type = "info", duration = 2500) {
    const container = document.getElementById("toast-container");
    const toast = el("div", { className: `toast ${type}`, textContent: msg });
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity .3s";
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, duration);
  }

  // ─────────────────────────────────────────────
  // API
  // ─────────────────────────────────────────────
  async function apiGet(path) {
    const res = await fetch(API_BASE + path, {
      headers: { "X-Telegram-Init-Data": initData },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Ошибка сети" }));
      throw new Error(err.detail || "Ошибка");
    }
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Ошибка сети" }));
      throw new Error(err.detail || "Ошибка");
    }
    return res.json();
  }

  // ─────────────────────────────────────────────
  // DEBOUNCE LOCK
  // ─────────────────────────────────────────────
  async function withLock(fn) {
    if (isLocked) return;
    isLocked = true;
    try {
      await fn();
    } catch (e) {
      showToast(e.message || "Ошибка", "error");
    } finally {
      isLocked = false;
    }
  }

  // ─────────────────────────────────────────────
  // HERO LOAD (with TTL cache)
  // ─────────────────────────────────────────────
  async function loadHero(force = false) {
    const now = Date.now();
    if (!force && heroData && now - heroLastFetch < HERO_CACHE_TTL) {
      renderHero(heroData);
      return heroData;
    }
    const data = await apiGet("/api/hero");
    heroData = data;
    heroLastFetch = Date.now();
    renderHero(data);
    return data;
  }

  // ─────────────────────────────────────────────
  // RENDER HERO
  // ─────────────────────────────────────────────
  function renderHero(d) {
    setText("hero-name", d.first_name || d.username || "Герой");
    setText("hero-level", `Ур.${d.level}`);
    setText("hero-streak", `${d.streak} дн.`);
    setText("hero-month-xp", d.current_month_xp);
    setText("hero-hp-text", `${d.hp}/100`);
    setText("hero-xp-text", `${d.xp_current}/${d.xp_needed}`);
    setText("water-count", d.water_count);
    setText("water-goal", d.water_goal);
    setText("shop-month-xp", d.current_month_xp);

    setWidth("hero-hp-bar", `${d.hp}%`);
    setWidth("hero-xp-bar", `${Math.min(100, Math.round((d.xp_current / d.xp_needed) * 100))}%`);
    const waterPct = d.water_goal > 0 ? Math.min(100, Math.round((d.water_count / d.water_goal) * 100)) : 0;
    setWidth("water-bar", `${waterPct}%`);

    renderSleepState(d.sleep_start);
    renderTaskLists(d);
    renderShop(d);
    renderCustomHabits(d);

    // Bio prefill
    const bioWeight = document.getElementById("bio-weight");
    if (bioWeight && !bioWeight.dataset.dirty) {
      bioWeight.value = d.weight || 70;
    }
    selectedActivityFactor = d.activity_factor || 1.0;
    renderActivitySelector();
    updateWaterCalc();
  }

  function setText(id, val) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(val);
  }

  function setWidth(id, val) {
    const node = document.getElementById(id);
    if (node) node.style.width = val;
  }

  // ─────────────────────────────────────────────
  // SLEEP STATE
  // ─────────────────────────────────────────────
  function renderSleepState(sleepStart) {
    const btn = document.getElementById("btn-sleep");
    const statusEl = document.getElementById("sleep-status");
    const timerEl = document.getElementById("sleep-timer");

    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }

    if (sleepStart) {
      const startDate = new Date(sleepStart);
      btn.textContent = "☀️ Проснуться";
      btn.classList.add("sleep-active");
      statusEl.textContent = `Засыпание: ${startDate.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}`;

      function updateTimer() {
        const diff = Math.floor((Date.now() - startDate.getTime()) / 1000);
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        timerEl.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }
      updateTimer();
      sleepTimerInterval = setInterval(updateTimer, 1000);
    } else {
      btn.textContent = "🌙 Уснуть";
      btn.classList.remove("sleep-active");
      statusEl.textContent = "Не сплю";
      timerEl.textContent = "";
    }
  }

  // ─────────────────────────────────────────────
  // TASK LISTS
  // ─────────────────────────────────────────────
  function renderTaskLists(d) {
    const completed = d.completed_tasks || [];
    const tasks = d.tasks || {};

    const activityList = document.getElementById("list-activity");
    const relationsList = document.getElementById("list-relations");
    clearEl(activityList);
    clearEl(relationsList);

    for (const [taskId, task] of Object.entries(tasks)) {
      const isDone = completed.includes(taskId);
      const item = buildTaskItem(taskId, task.name, task.xp, isDone);
      if (task.category === "activity") activityList.appendChild(item);
      else if (task.category === "relations") relationsList.appendChild(item);
    }
  }

  function buildTaskItem(taskId, name, xp, isDone) {
    const row = el("div", {
      className: `task-item flex items-center justify-between gap-2 p-3 rounded-xl ${isDone ? "done" : ""}`,
      style: { background: "rgba(255,255,255,.04)" },
    });

    const left = el("div", { className: "flex items-center gap-2 flex-1 min-w-0" });
    const checkIcon = el("span", { textContent: isDone ? "✅" : "⭕", style: { flexShrink: "0" } });
    const nameEl = el("span", { className: "text-sm truncate", textContent: name });
    left.appendChild(checkIcon);
    left.appendChild(nameEl);

    const right = el("div", { className: "flex items-center gap-2 flex-shrink-0" });
    const xpBadge = el("span", {
      className: "text-xs font-semibold text-blue-400",
      textContent: `+${xp} XP`,
    });
    right.appendChild(xpBadge);

    if (!isDone) {
      const btn = el("button", {
        className: "btn-primary text-white text-xs px-3 py-1.5",
        textContent: "Выполнить",
        "data-task-id": taskId,
      });
      btn.addEventListener("click", () => withLock(() => doCompleteTask(taskId)));
      right.appendChild(btn);
    }

    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  // ─────────────────────────────────────────────
  // CUSTOM HABITS
  // ─────────────────────────────────────────────
  function renderCustomHabits(d) {
    const list = document.getElementById("list-custom");
    clearEl(list);
    const habits = d.custom_habits || [];
    const completed = d.completed_tasks || [];

    if (habits.length === 0) {
      const empty = el("div", {
        className: "text-xs py-2",
        textContent: "Нет привычек. Добавьте первую!",
        style: { color: "var(--text-muted)" },
      });
      list.appendChild(empty);
      return;
    }

    for (const habit of habits) {
      const isDone = completed.includes(habit.id);
      const row = el("div", {
        className: "flex items-center justify-between gap-2 p-3 rounded-xl",
        style: { background: "rgba(255,255,255,.04)" },
      });

      const left = el("div", { className: "flex items-center gap-2 flex-1 min-w-0" });
      const check = el("span", { textContent: isDone ? "✅" : "⭕", style: { flexShrink: "0" } });
      const nameEl = el("span", { className: "text-sm truncate", textContent: habit.name });
      const xpEl = el("span", { className: "text-xs text-blue-400 ml-1", textContent: `+${habit.xp}XP` });
      left.appendChild(check);
      left.appendChild(nameEl);
      left.appendChild(xpEl);

      const right = el("div", { className: "flex items-center gap-1 flex-shrink-0" });

      if (!isDone) {
        const doneBtn = el("button", { className: "btn-primary text-white text-xs px-2 py-1.5", textContent: "✓" });
        doneBtn.addEventListener("click", () => withLock(() => doCompleteTask(habit.id)));
        right.appendChild(doneBtn);
      }

      const editBtn = el("button", { className: "btn-secondary text-xs px-2 py-1.5", textContent: "✏️" });
      editBtn.addEventListener("click", () => openEditHabitModal(habit));
      right.appendChild(editBtn);

      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    }
  }

  // ─────────────────────────────────────────────
  // SHOP
  // ─────────────────────────────────────────────
  function renderShop(d) {
    const list = document.getElementById("shop-list");
    if (!list || !d.rewards) return;
    clearEl(list);

    for (const [rewardId, reward] of Object.entries(d.rewards)) {
      const canAfford = d.current_month_xp >= reward.cost;
      const card = el("div", { className: "card card-glow p-4 flex items-center justify-between gap-3" });

      const left = el("div", { className: "flex-1 min-w-0" });
      const name = el("div", { className: "font-semibold text-sm", textContent: reward.name });
      const desc = el("div", { className: "text-xs mt-0.5", textContent: reward.description, style: { color: "var(--text-muted)" } });
      left.appendChild(name);
      left.appendChild(desc);

      const right = el("div", { className: "flex flex-col items-end gap-2 flex-shrink-0" });
      const cost = el("div", {
        className: "font-game text-sm font-bold",
        textContent: `${reward.cost} 🪙`,
        style: { color: canAfford ? "#f59e0b" : "var(--text-muted)" },
      });
      const btn = el("button", {
        className: `btn-primary text-white text-xs px-4 py-1.5${canAfford ? "" : " opacity-40 pointer-events-none"}`,
        textContent: "Купить",
      });
      if (canAfford) {
        btn.addEventListener("click", () => withLock(() => doBuyReward(rewardId)));
      }
      right.appendChild(cost);
      right.appendChild(btn);

      card.appendChild(left);
      card.appendChild(right);
      list.appendChild(card);
    }
  }

  // ─────────────────────────────────────────────
  // JOURNAL
  // ─────────────────────────────────────────────
  async function loadJournal() {
    const list = document.getElementById("journal-list");
    clearEl(list);
    const loadingEl = el("div", {
      className: "text-sm text-center py-8",
      textContent: "Загрузка...",
      style: { color: "var(--text-muted)" },
    });
    list.appendChild(loadingEl);

    try {
      const data = await apiGet("/api/history");
      clearEl(list);
      if (!data.history || data.history.length === 0) {
        list.appendChild(el("div", {
          className: "text-sm text-center py-8",
          textContent: "История пуста",
          style: { color: "var(--text-muted)" },
        }));
        return;
      }
      for (const record of data.history) {
        list.appendChild(buildJournalItem(record));
      }
    } catch (e) {
      clearEl(list);
      list.appendChild(el("div", {
        className: "text-sm text-center py-8 text-red-400",
        textContent: "Ошибка загрузки",
      }));
    }
  }

  function buildJournalItem(record) {
    const icon = EVENT_ICONS[record.event_type] || "📌";
    const dt = new Date(record.timestamp);
    const timeStr = dt.toLocaleString("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

    const row = el("div", { className: "card p-3 flex items-center gap-3" });
    const iconEl = el("span", { className: "text-xl flex-shrink-0", textContent: icon });
    const mid = el("div", { className: "flex-1 min-w-0" });
    const desc = el("div", { className: "text-sm truncate", textContent: record.description });
    const time = el("div", { className: "text-xs mt-0.5", textContent: timeStr, style: { color: "var(--text-muted)" } });
    mid.appendChild(desc);
    mid.appendChild(time);

    const right = el("div", { className: "text-xs flex-shrink-0 flex flex-col items-end gap-0.5" });
    if (record.xp_delta !== 0) {
      const xpEl = el("span", {
        className: record.xp_delta > 0 ? "text-blue-400" : "text-red-400",
        textContent: (record.xp_delta > 0 ? "+" : "") + record.xp_delta + " XP",
      });
      right.appendChild(xpEl);
    }
    if (record.hp_delta !== 0) {
      const hpEl = el("span", {
        className: record.hp_delta > 0 ? "text-green-400" : "text-red-400",
        textContent: (record.hp_delta > 0 ? "+" : "") + record.hp_delta + " HP",
      });
      right.appendChild(hpEl);
    }

    row.appendChild(iconEl);
    row.appendChild(mid);
    row.appendChild(right);
    return row;
  }

  // ─────────────────────────────────────────────
  // ACTIONS
  // ─────────────────────────────────────────────
  async function doAddWater() {
    const data = await apiPost("/api/water", { amount: 1 });
    heroData = data.hero;
    heroLastFetch = Date.now();
    renderHero(data.hero);
    showToast(`+${data.xp_gained} XP 💧 +${data.hp_gained} HP`, "success");
  }

  async function doSleep() {
    if (heroData && heroData.sleep_start) {
      const data = await apiPost("/api/sleep/end", {});
      heroData = data.hero;
      heroLastFetch = Date.now();
      renderHero(data.hero);
      showToast(data.message + ` +${data.xp_gained} XP`, "success");
    } else {
      const data = await apiPost("/api/sleep/start", {});
      if (heroData) heroData.sleep_start = data.sleep_start;
      renderSleepState(data.sleep_start);
      showToast("Спокойной ночи! 🌙", "success");
    }
  }

  async function doCompleteTask(taskId) {
    const data = await apiPost("/api/task/complete", { task_id: taskId });
    heroData = data.hero;
    heroLastFetch = Date.now();
    renderHero(data.hero);
    showToast(`+${data.xp_gained} XP ✅`, "success");
  }

  async function doBuyReward(rewardId) {
    const data = await apiPost("/api/shop/buy", { reward_id: rewardId });
    heroData = data.hero;
    heroLastFetch = Date.now();
    renderHero(data.hero);
    showToast(`Куплено: ${data.purchased} 🎉`, "success");
  }

  async function doSaveBio() {
    const weightInput = document.getElementById("bio-weight");
    const weight = parseFloat(weightInput.value);
    if (!weight || weight <= 0 || weight > 500) {
      showToast("Введите корректный вес", "error");
      return;
    }
    const data = await apiPost("/api/bio/update", { weight, activity_factor: selectedActivityFactor });
    heroData = data.hero;
    heroLastFetch = Date.now();
    renderHero(data.hero);
    showToast("Биометрия сохранена ✅", "success");
    weightInput.dataset.dirty = "";
  }

  async function doAddHabit(name, xp, category) {
    const data = await apiPost("/api/habit/add", { name, xp, category });
    heroData = data.hero;
    heroLastFetch = Date.now();
    renderHero(data.hero);
    closeModal();
    showToast("Привычка добавлена!", "success");
  }

  async function doEditHabit(habitId, name, xp) {
    const data = await apiPost("/api/habit/edit", { habit_id: habitId, name, xp });
    heroData = data.hero;
    heroLastFetch = Date.now();
    renderHero(data.hero);
    closeModal();
    showToast("Привычка обновлена!", "success");
  }

  async function doDeleteHabit(habitId) {
    const data = await apiPost("/api/habit/delete", { habit_id: habitId });
    heroData = data.hero;
    heroLastFetch = Date.now();
    renderHero(data.hero);
    closeModal();
    showToast("Привычка удалена", "info");
  }

  // ─────────────────────────────────────────────
  // MODALS
  // ─────────────────────────────────────────────
  function openModal() {
    document.getElementById("modal-overlay").classList.remove("hidden");
  }

  function closeModal() {
    document.getElementById("modal-overlay").classList.add("hidden");
    clearEl(document.getElementById("modal-box"));
  }

  function openAddHabitModal() {
    const box = document.getElementById("modal-box");
    clearEl(box);

    box.appendChild(el("div", { className: "font-game font-bold text-base mb-4", textContent: "✨ Новая привычка" }));

    const nameLabel = el("label", { className: "block text-xs mb-1", textContent: "Название", style: { color: "var(--text-muted)" } });
    const nameInput = el("input", {
      type: "text",
      className: "w-full rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500",
      style: { background: "rgba(255,255,255,.07)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.1)" },
      placeholder: "Пробежка 3км",
    });

    const xpLabel = el("label", { className: "block text-xs mb-1", textContent: "XP за выполнение", style: { color: "var(--text-muted)" } });
    const xpInput = el("input", {
      type: "number",
      className: "w-full rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500",
      style: { background: "rgba(255,255,255,.07)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.1)" },
      placeholder: "25",
      min: "1",
      max: "200",
    });

    const catLabel = el("label", { className: "block text-xs mb-1", textContent: "Категория", style: { color: "var(--text-muted)" } });
    const catSelect = el("select", {
      className: "w-full rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500",
      style: { background: "rgba(22,27,34,1)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.1)" },
    });
    [
      { value: "activity", text: "🏃 Активность" },
      { value: "relations", text: "🤝 Отношения" },
      { value: "custom", text: "✨ Своя" },
    ].forEach(({ value, text }) => {
      const opt = el("option", { value, textContent: text });
      catSelect.appendChild(opt);
    });

    const btnRow = el("div", { className: "flex gap-2" });
    const cancelBtn = el("button", { className: "btn-secondary flex-1 py-2.5 text-sm", textContent: "Отмена" });
    cancelBtn.addEventListener("click", closeModal);

    const addBtn = el("button", { className: "btn-primary flex-1 py-2.5 text-sm text-white", textContent: "Добавить" });
    addBtn.addEventListener("click", () => withLock(async () => {
      const name = nameInput.value.trim();
      const xp = parseInt(xpInput.value, 10);
      const category = catSelect.value;
      if (!name) { showToast("Введите название", "error"); return; }
      if (!xp || xp <= 0) { showToast("XP должно быть больше 0", "error"); return; }
      await doAddHabit(name, xp, category);
    }));

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(addBtn);

    box.appendChild(nameLabel);
    box.appendChild(nameInput);
    box.appendChild(xpLabel);
    box.appendChild(xpInput);
    box.appendChild(catLabel);
    box.appendChild(catSelect);
    box.appendChild(btnRow);
    openModal();
  }

  function openEditHabitModal(habit) {
    const box = document.getElementById("modal-box");
    clearEl(box);

    box.appendChild(el("div", { className: "font-game font-bold text-base mb-4", textContent: "✏️ Редактировать" }));

    const nameLabel = el("label", { className: "block text-xs mb-1", textContent: "Название", style: { color: "var(--text-muted)" } });
    const nameInput = el("input", {
      type: "text",
      className: "w-full rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500",
      style: { background: "rgba(255,255,255,.07)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.1)" },
      value: habit.name,
    });

    const xpLabel = el("label", { className: "block text-xs mb-1", textContent: "XP", style: { color: "var(--text-muted)" } });
    const xpInput = el("input", {
      type: "number",
      className: "w-full rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500",
      style: { background: "rgba(255,255,255,.07)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.1)" },
      value: String(habit.xp),
      min: "1",
      max: "200",
    });

    const btnRow = el("div", { className: "flex gap-2 mb-2" });
    const cancelBtn = el("button", { className: "btn-secondary flex-1 py-2.5 text-sm", textContent: "Отмена" });
    cancelBtn.addEventListener("click", closeModal);

    const saveBtn = el("button", { className: "btn-primary flex-1 py-2.5 text-sm text-white", textContent: "Сохранить" });
    saveBtn.addEventListener("click", () => withLock(async () => {
      const name = nameInput.value.trim();
      const xp = parseInt(xpInput.value, 10);
      if (!name) { showToast("Введите название", "error"); return; }
      if (!xp || xp <= 0) { showToast("XP должно быть больше 0", "error"); return; }
      await doEditHabit(habit.id, name, xp);
    }));

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);

    const delBtn = el("button", {
      className: "w-full py-2.5 text-sm rounded-xl font-semibold",
      textContent: "🗑️ Удалить привычку",
      style: { background: "rgba(239,68,68,.15)", color: "#f87171", border: "1px solid rgba(239,68,68,.2)" },
    });
    delBtn.addEventListener("click", () => withLock(() => doDeleteHabit(habit.id)));

    box.appendChild(nameLabel);
    box.appendChild(nameInput);
    box.appendChild(xpLabel);
    box.appendChild(xpInput);
    box.appendChild(btnRow);
    box.appendChild(delBtn);
    openModal();
  }

  // ─────────────────────────────────────────────
  // ACTIVITY SELECTOR (Bio tab)
  // ─────────────────────────────────────────────
  function renderActivitySelector() {
    const container = document.getElementById("activity-selector");
    clearEl(container);

    for (const opt of ACTIVITY_OPTIONS) {
      const btn = el("button", {
        className: `btn-secondary p-3 text-left rounded-xl transition-all`,
        "data-factor": String(opt.value),
      });
      if (Math.abs(opt.value - selectedActivityFactor) < 0.01) {
        btn.style.borderColor = "rgba(99,102,241,.6)";
        btn.style.background = "rgba(99,102,241,.15)";
      }
      const label = el("div", { className: "text-sm font-semibold", textContent: opt.label });
      const sub = el("div", { className: "text-xs mt-0.5", textContent: opt.sub, style: { color: "var(--text-muted)" } });
      btn.appendChild(label);
      btn.appendChild(sub);
      btn.addEventListener("click", () => {
        selectedActivityFactor = opt.value;
        renderActivitySelector();
        updateWaterCalc();
      });
      container.appendChild(btn);
    }
  }

  function updateWaterCalc() {
    const weightInput = document.getElementById("bio-weight");
    const calcEl = document.getElementById("bio-water-calc");
    if (!weightInput || !calcEl) return;
    const weight = parseFloat(weightInput.value) || (heroData ? heroData.weight : 70);
    const goal = Math.max(1, Math.round(weight * selectedActivityFactor / 250));
    calcEl.textContent = String(goal);
  }

  // ─────────────────────────────────────────────
  // ACCORDIONS
  // ─────────────────────────────────────────────
  function setupAccordion(btnId, bodyId, arrowId) {
    const btn = document.getElementById(btnId);
    const body = document.getElementById(bodyId);
    const arrow = document.getElementById(arrowId);
    let open = false;

    btn.addEventListener("click", () => {
      open = !open;
      if (open) {
        body.style.height = body.scrollHeight + "px";
        arrow.style.transform = "rotate(90deg)";
        arrow.style.transition = "transform .3s";
      } else {
        body.style.height = "0px";
        arrow.style.transform = "rotate(0deg)";
      }
      // Recalc after content renders
      requestAnimationFrame(() => {
        if (open) body.style.height = body.scrollHeight + "px";
      });
    });
  }

  // ─────────────────────────────────────────────
  // TABS
  // ─────────────────────────────────────────────
  function switchTab(tab) {
    currentTab = tab;

    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));

    const panel = document.getElementById(`tab-${tab}`);
    if (panel) panel.classList.remove("hidden");

    const navBtn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
    if (navBtn) navBtn.classList.add("active");

    if (tab === "path" || tab === "bio" || tab === "shop") {
      loadHero().catch((e) => showToast(e.message, "error"));
    } else if (tab === "journal") {
      loadJournal();
    }
  }

  // ─────────────────────────────────────────────
  // SPLASH
  // ─────────────────────────────────────────────
  function showSplashError(msg) {
    const status = document.getElementById("splash-status");
    const reloadBtn = document.getElementById("splash-reload-btn");
    const loader = document.getElementById("splash-loader");
    if (status) status.textContent = msg;
    if (loader) loader.style.display = "none";
    if (reloadBtn) {
      reloadBtn.classList.remove("hidden");
      reloadBtn.addEventListener("click", () => location.reload(), { once: true });
    }
  }

  function hideSplash() {
    const splash = document.getElementById("splash");
    if (splash) {
      splash.classList.add("hidden");
      setTimeout(() => { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 500);
    }
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
  }

  // ─────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────
  async function init() {
    const tg = getTg();
    if (tg) {
      tg.ready();
      tg.expand();
      initData = tg.initData || "";
    } else {
      // Dev mode fallback
      initData = "";
    }

    if (!initData) {
      showSplashError("Откройте приложение через Telegram");
      return;
    }

    // Setup accordions
    setupAccordion("accordion-activity-btn", "accordion-activity-body", "arrow-activity");
    setupAccordion("accordion-relations-btn", "accordion-relations-body", "arrow-relations");
    setupAccordion("accordion-custom-btn", "accordion-custom-body", "arrow-custom");

    // Nav
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        if (tab) switchTab(tab);
      });
    });

    // Modal overlay close on backdrop click
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target === document.getElementById("modal-overlay")) closeModal();
    });

    // Bio weight input
    const bioWeight = document.getElementById("bio-weight");
    bioWeight.addEventListener("input", () => {
      bioWeight.dataset.dirty = "1";
      updateWaterCalc();
    });

    // Buttons
    document.getElementById("btn-water").addEventListener("click", () => withLock(doAddWater));
    document.getElementById("btn-sleep").addEventListener("click", () => withLock(doSleep));
    document.getElementById("btn-bio-save").addEventListener("click", () => withLock(doSaveBio));
    document.getElementById("btn-add-habit").addEventListener("click", () => openAddHabitModal());

    // Tab focus cache
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && (currentTab === "path" || currentTab === "shop")) {
        loadHero().catch(() => {});
      }
    });

    // Load initial data
    const splashStatus = document.getElementById("splash-status");
    if (splashStatus) splashStatus.textContent = "Загрузка героя...";

    try {
      await loadHero(true);
      renderActivitySelector();
      hideSplash();
      switchTab("path");
    } catch (e) {
      showSplashError("Ошибка подключения к серверу");
    }
  }

  // Start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
