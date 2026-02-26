/**
 * Life RPG — Telegram Mini App Client
 *
 * Security: no innerHTML anywhere, DOM Builder pattern, global debounce lock.
 * Telegram SDK: per official docs https://core.telegram.org/bots/webapps
 *   - tg.ready() called FIRST before any async work
 *   - tg.expand() to fill screen
 *   - disableVerticalSwipes() to prevent accidental close
 *   - setHeaderColor / setBackgroundColor / setBottomBarColor
 *   - enableClosingConfirmation()
 *   - HapticFeedback on all actions
 *   - initData for backend auth, initDataUnsafe only for display
 */
(function () {
  "use strict";

  // ─────────────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────────────
  const API_BASE       = "";       // same-origin; change to full URL if hosted separately
  const HERO_CACHE_TTL = 10000;    // 10 seconds

  const ACTIVITY_OPTIONS = [
    { value: 1.0,   label: "🪑 Сидячий",   sub: "×1.0" },
    { value: 1.375, label: "🚶 Лёгкий",    sub: "×1.375" },
    { value: 1.55,  label: "🏃 Умеренный", sub: "×1.55" },
    { value: 1.725, label: "💪 Высокий",   sub: "×1.725" },
  ];

  const EVENT_ICONS = {
    water:   "💧",
    sleep:   "😴",
    task:    "✅",
    shop:    "🛒",
    penalty: "⚠️",
  };

  // ─────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────
  let heroData               = null;
  let heroLastFetch          = 0;
  let isLocked               = false;
  let initData               = "";
  let sleepTimerInterval     = null;
  let selectedActivityFactor = 1.0;
  let currentTab             = "path";
  let tgApp                  = null;   // window.Telegram.WebApp

  // ─────────────────────────────────────────────
  // MOCK DATA — dev mode (no Telegram / no backend)
  // ─────────────────────────────────────────────
  const MOCK_HERO_TPL = {
    telegram_id: "dev_user",
    first_name: "Разработчик",
    username: "dev",
    hp: 85,
    xp: 240,
    level: 3,
    current_month_xp: 120,
    xp_current: 40,
    xp_needed: 132,
    water_count: 3,
    water_goal: 8,
    weight: 70,
    activity_factor: 1.375,
    completed_tasks: ["meditation"],
    sleep_start: null,
    coins: 0,
    streak: 5,
    custom_habits: [
      { id: "custom_demo1", name: "Контрастный душ", xp: 20, category: "custom" },
    ],
    tasks: {
      workout_light:  { name: "Лёгкая тренировка",         xp: 20, category: "activity" },
      workout_medium: { name: "Средняя тренировка",         xp: 35, category: "activity" },
      workout_hard:   { name: "Интенсивная тренировка",     xp: 50, category: "activity" },
      meditation:     { name: "Медитация 10 мин",           xp: 15, category: "activity" },
      reading:        { name: "Чтение 30 мин",              xp: 15, category: "activity" },
      walk:           { name: "Прогулка на свежем воздухе", xp: 20, category: "activity" },
      friend_call:    { name: "Позвонить другу",            xp: 20, category: "relations" },
      family_time:    { name: "Провести время с семьёй",    xp: 25, category: "relations" },
      gratitude:      { name: "Написать благодарность",     xp: 10, category: "relations" },
      social_event:   { name: "Социальное мероприятие",     xp: 30, category: "relations" },
    },
    rewards: {
      coffee:     { name: "☕ Кофе с собой", cost: 50,  description: "Заслуженный кофе" },
      movie:      { name: "🎬 Кино",         cost: 100, description: "Поход в кино" },
      game_hour:  { name: "🎮 Час игр",      cost: 75,  description: "Час любимых игр" },
      cheat_meal: { name: "🍕 Читмил",       cost: 120, description: "Читмил без угрызений совести" },
      spa:        { name: "💆 Спа-день",     cost: 300, description: "День отдыха и восстановления" },
    },
  };

  // ─────────────────────────────────────────────
  // HAPTIC FEEDBACK
  // ─────────────────────────────────────────────
  function haptic(type, style) {
    if (!tgApp || !tgApp.HapticFeedback) return;
    try {
      if (type === "impact")       tgApp.HapticFeedback.impactOccurred(style || "light");
      if (type === "notification") tgApp.HapticFeedback.notificationOccurred(style || "success");
      if (type === "selection")    tgApp.HapticFeedback.selectionChanged();
    } catch (_) {}
  }

  // ─────────────────────────────────────────────
  // SECURE DOM BUILDER — no innerHTML EVER
  // ─────────────────────────────────────────────
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className")        node.className = v;
        else if (k === "textContent") node.textContent = v;
        else if (k === "style")       Object.assign(node.style, v);
        else if (k.startsWith("data-")) node.setAttribute(k, v);
        else                          node.setAttribute(k, v);
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
  function showToast(msg, type, duration) {
    type = type || "info";
    duration = duration || 2500;
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = el("div", { className: "toast " + type, textContent: msg });
    container.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = "0";
      toast.style.transition = "opacity .3s";
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, duration);
  }

  // ─────────────────────────────────────────────
  // DEV MODE CHECK
  // ─────────────────────────────────────────────
  function isDevMode() {
    return !tgApp || !tgApp.initData;
  }

  // ─────────────────────────────────────────────
  // API
  // ─────────────────────────────────────────────
  async function apiGet(path) {
    if (isDevMode()) return mockApiGet(path);
    const res = await fetch(API_BASE + path, {
      headers: { "X-Telegram-Init-Data": initData },
    });
    if (!res.ok) {
      const err = await res.json().catch(function () { return { detail: "Ошибка сети" }; });
      throw new Error(err.detail || "Ошибка");
    }
    return res.json();
  }

  async function apiPost(path, body) {
    if (isDevMode()) return mockApiPost(path, body);
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(function () { return { detail: "Ошибка сети" }; });
      throw new Error(err.detail || "Ошибка");
    }
    return res.json();
  }

  // ─────────────────────────────────────────────
  // MOCK API
  // ─────────────────────────────────────────────
  function mockApiGet(path) {
    if (path === "/api/hero") {
      if (!heroData) heroData = JSON.parse(JSON.stringify(MOCK_HERO_TPL));
      return Promise.resolve(JSON.parse(JSON.stringify(heroData)));
    }
    if (path === "/api/history") {
      return Promise.resolve({
        history: [
          { id: 1, event_type: "task",    description: "Медитация 10 мин",           xp_delta: 15,  hp_delta: 0,   timestamp: new Date().toISOString() },
          { id: 2, event_type: "water",   description: "Выпито 1 стакан(ов) воды",   xp_delta: 5,   hp_delta: 5,   timestamp: new Date(Date.now() - 3600000).toISOString() },
          { id: 3, event_type: "sleep",   description: "Сон 7.5ч засчитан",          xp_delta: 80,  hp_delta: 20,  timestamp: new Date(Date.now() - 86400000).toISOString() },
          { id: 4, event_type: "penalty", description: "Штраф за 2 пропущенных дня", xp_delta: 0,   hp_delta: -30, timestamp: new Date(Date.now() - 172800000).toISOString() },
        ]
      });
    }
    return Promise.resolve({});
  }

  function mockApiPost(path, body) {
    if (!heroData) heroData = JSON.parse(JSON.stringify(MOCK_HERO_TPL));

    if (path === "/api/water") {
      var amount = body.amount || 1;
      var xp = amount * 5; var hp = amount * 5;
      heroData.water_count = (heroData.water_count || 0) + amount;
      heroData.hp = Math.min(100, (heroData.hp || 0) + hp);
      heroData.xp += xp; heroData.current_month_xp += xp;
      heroData.xp_current = (heroData.xp_current || 0) + xp;
      return Promise.resolve({ ok: true, xp_gained: xp, hp_gained: hp, hero: JSON.parse(JSON.stringify(heroData)) });
    }

    if (path === "/api/sleep/start") {
      if (heroData.sleep_start) return Promise.reject(new Error("Уже спишь"));
      heroData.sleep_start = new Date().toISOString();
      return Promise.resolve({ ok: true, sleep_start: heroData.sleep_start });
    }

    if (path === "/api/sleep/end") {
      if (!heroData.sleep_start) return Promise.reject(new Error("Не спишь"));
      var dur = (Date.now() - new Date(heroData.sleep_start).getTime()) / 3600000;
      var sxp = dur >= 7.5 ? 50 : dur >= 5 ? 30 : dur >= 3 ? 15 : 10;
      var shp = dur >= 7.5 ? 20 : dur >= 5 ? 15 : dur >= 3 ? 10 : 5;
      heroData.sleep_start = null;
      heroData.xp += sxp; heroData.current_month_xp += sxp; heroData.xp_current += sxp;
      heroData.hp = Math.min(100, heroData.hp + shp);
      var durRound = Math.round(dur * 10) / 10;
      return Promise.resolve({ ok: true, xp_gained: sxp, hp_gained: shp, duration_hours: durRound, message: "Сон " + durRound + "ч засчитан", hero: JSON.parse(JSON.stringify(heroData)) });
    }

    if (path === "/api/task/complete") {
      var taskId = body.task_id;
      var allTasks = Object.assign({}, heroData.tasks,
        Object.fromEntries((heroData.custom_habits || []).map(function (h) { return [h.id, h]; }))
      );
      var task = allTasks[taskId];
      if (!task) return Promise.reject(new Error("Задача не найдена"));
      if ((heroData.completed_tasks || []).indexOf(taskId) !== -1)
        return Promise.reject(new Error("Задача уже выполнена сегодня"));
      var txp = task.xp;
      heroData.completed_tasks = (heroData.completed_tasks || []).concat([taskId]);
      heroData.xp += txp; heroData.current_month_xp += txp;
      heroData.xp_current = (heroData.xp_current || 0) + txp;
      return Promise.resolve({ ok: true, xp_gained: txp, hero: JSON.parse(JSON.stringify(heroData)) });
    }

    if (path === "/api/shop/buy") {
      var reward = (heroData.rewards || {})[body.reward_id];
      if (!reward) return Promise.reject(new Error("Награда не найдена"));
      if (heroData.current_month_xp < reward.cost) return Promise.reject(new Error("Недостаточно монет"));
      heroData.current_month_xp -= reward.cost;
      return Promise.resolve({ ok: true, purchased: reward.name, hero: JSON.parse(JSON.stringify(heroData)) });
    }

    if (path === "/api/bio/update") {
      heroData.weight = body.weight;
      heroData.activity_factor = body.activity_factor;
      heroData.water_goal = Math.max(1, Math.round(body.weight * body.activity_factor / 250));
      return Promise.resolve({ ok: true, water_goal: heroData.water_goal, hero: JSON.parse(JSON.stringify(heroData)) });
    }

    if (path === "/api/habit/add") {
      var hid = "custom_" + Math.random().toString(36).slice(2, 10);
      var habit = { id: hid, name: body.name, xp: body.xp, category: body.category };
      heroData.custom_habits = (heroData.custom_habits || []).concat([habit]);
      return Promise.resolve({ ok: true, habit_id: hid, hero: JSON.parse(JSON.stringify(heroData)) });
    }

    if (path === "/api/habit/edit") {
      heroData.custom_habits = (heroData.custom_habits || []).map(function (h) {
        return h.id === body.habit_id ? Object.assign({}, h, { name: body.name, xp: body.xp }) : h;
      });
      return Promise.resolve({ ok: true, hero: JSON.parse(JSON.stringify(heroData)) });
    }

    if (path === "/api/habit/delete") {
      heroData.custom_habits = (heroData.custom_habits || []).filter(function (h) { return h.id !== body.habit_id; });
      return Promise.resolve({ ok: true, hero: JSON.parse(JSON.stringify(heroData)) });
    }

    return Promise.resolve({ ok: true });
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
      haptic("notification", "error");
      showToast(e.message || "Ошибка", "error");
    } finally {
      isLocked = false;
    }
  }

  // ─────────────────────────────────────────────
  // HERO LOAD with TTL cache
  // ─────────────────────────────────────────────
  async function loadHero(force) {
    force = force || false;
    var now = Date.now();
    if (!force && heroData && (now - heroLastFetch) < HERO_CACHE_TTL) {
      renderHero(heroData);
      return heroData;
    }
    var data = await apiGet("/api/hero");
    heroData = data;
    heroLastFetch = Date.now();
    renderHero(data);
    return data;
  }

  // ─────────────────────────────────────────────
  // RENDER HERO
  // ─────────────────────────────────────────────
  function renderHero(d) {
    setText("hero-name",     d.first_name || d.username || "Герой");
    setText("hero-level",    "Ур." + d.level);
    setText("hero-streak",   d.streak + " дн.");
    setText("hero-month-xp", d.current_month_xp);
    setText("hero-hp-text",  d.hp + "/100");
    setText("hero-xp-text",  d.xp_current + "/" + d.xp_needed);
    setText("water-count",   d.water_count);
    setText("water-goal",    d.water_goal);
    setText("shop-month-xp", d.current_month_xp);

    setWidth("hero-hp-bar", d.hp + "%");
    var xpPct = d.xp_needed > 0 ? Math.min(100, Math.round((d.xp_current / d.xp_needed) * 100)) : 0;
    setWidth("hero-xp-bar", xpPct + "%");
    var waterPct = d.water_goal > 0 ? Math.min(100, Math.round((d.water_count / d.water_goal) * 100)) : 0;
    setWidth("water-bar", waterPct + "%");

    renderSleepState(d.sleep_start);
    renderTaskLists(d);
    renderShop(d);
    renderCustomHabits(d);

    var bioWeight = document.getElementById("bio-weight");
    if (bioWeight && !bioWeight.dataset.dirty) bioWeight.value = d.weight || 70;
    selectedActivityFactor = d.activity_factor || 1.0;
    renderActivitySelector();
    updateWaterCalc();
  }

  function setText(id, val) {
    var node = document.getElementById(id);
    if (node) node.textContent = String(val);
  }

  function setWidth(id, val) {
    var node = document.getElementById(id);
    if (node) node.style.width = val;
  }

  // ─────────────────────────────────────────────
  // SLEEP STATE
  // ─────────────────────────────────────────────
  function renderSleepState(sleepStart) {
    var btn      = document.getElementById("btn-sleep");
    var statusEl = document.getElementById("sleep-status");
    var timerEl  = document.getElementById("sleep-timer");
    if (!btn || !statusEl || !timerEl) return;

    if (sleepTimerInterval) { clearInterval(sleepTimerInterval); sleepTimerInterval = null; }

    if (sleepStart) {
      var startDate = new Date(sleepStart);
      btn.textContent = "☀️ Проснуться";
      btn.classList.add("sleep-active");
      statusEl.textContent = "Засыпание: " + startDate.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });

      function updateTimer() {
        var diff = Math.floor((Date.now() - startDate.getTime()) / 1000);
        var h = Math.floor(diff / 3600);
        var m = Math.floor((diff % 3600) / 60);
        var s = diff % 60;
        timerEl.textContent = [h, m, s].map(function (n) { return String(n).padStart(2, "0"); }).join(":");
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
    var completed     = d.completed_tasks || [];
    var tasks         = d.tasks || {};
    var activityList  = document.getElementById("list-activity");
    var relationsList = document.getElementById("list-relations");
    if (!activityList || !relationsList) return;
    clearEl(activityList);
    clearEl(relationsList);

    for (var taskId in tasks) {
      if (!Object.prototype.hasOwnProperty.call(tasks, taskId)) continue;
      var task   = tasks[taskId];
      var isDone = completed.indexOf(taskId) !== -1;
      var item   = buildTaskItem(taskId, task.name, task.xp, isDone);
      if (task.category === "activity")  activityList.appendChild(item);
      else if (task.category === "relations") relationsList.appendChild(item);
    }
  }

  function buildTaskItem(taskId, name, xp, isDone) {
    var row = el("div", {
      className: "task-item flex items-center justify-between gap-2 p-3 rounded-xl" + (isDone ? " done" : ""),
      style: { background: "rgba(255,255,255,.04)" },
    });
    var left = el("div", { className: "flex items-center gap-2 flex-1 min-w-0" });
    left.appendChild(el("span", { textContent: isDone ? "✅" : "⭕", style: { flexShrink: "0" } }));
    left.appendChild(el("span", { className: "text-sm truncate", textContent: name }));

    var right = el("div", { className: "flex items-center gap-2 flex-shrink-0" });
    right.appendChild(el("span", { className: "text-xs font-semibold text-blue-400", textContent: "+" + xp + " XP" }));

    if (!isDone) {
      var btn = el("button", { className: "btn-primary text-white text-xs px-3 py-1.5", textContent: "Выполнить" });
      (function (id) {
        btn.addEventListener("click", function () {
          haptic("impact", "medium");
          withLock(function () { return doCompleteTask(id); });
        });
      }(taskId));
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
    var list = document.getElementById("list-custom");
    if (!list) return;
    clearEl(list);
    var habits    = d.custom_habits || [];
    var completed = d.completed_tasks || [];

    if (habits.length === 0) {
      list.appendChild(el("div", {
        className: "text-xs py-2",
        textContent: "Нет привычек. Добавьте первую!",
        style: { color: "var(--text-muted)" },
      }));
      return;
    }

    habits.forEach(function (habit) {
      var isDone = completed.indexOf(habit.id) !== -1;
      var row = el("div", {
        className: "flex items-center justify-between gap-2 p-3 rounded-xl",
        style: { background: "rgba(255,255,255,.04)" },
      });
      var left = el("div", { className: "flex items-center gap-2 flex-1 min-w-0" });
      left.appendChild(el("span", { textContent: isDone ? "✅" : "⭕", style: { flexShrink: "0" } }));
      left.appendChild(el("span", { className: "text-sm truncate", textContent: habit.name }));
      left.appendChild(el("span", { className: "text-xs text-blue-400 ml-1 flex-shrink-0", textContent: "+" + habit.xp + "XP" }));

      var right = el("div", { className: "flex items-center gap-1 flex-shrink-0" });

      if (!isDone) {
        var doneBtn = el("button", { className: "btn-primary text-white text-xs px-2 py-1.5", textContent: "✓" });
        (function (id) {
          doneBtn.addEventListener("click", function () {
            haptic("impact", "medium");
            withLock(function () { return doCompleteTask(id); });
          });
        }(habit.id));
        right.appendChild(doneBtn);
      }

      var editBtn = el("button", { className: "btn-secondary text-xs px-2 py-1.5", textContent: "✏️" });
      (function (h) {
        editBtn.addEventListener("click", function () {
          haptic("selection");
          openEditHabitModal(h);
        });
      }(habit));
      right.appendChild(editBtn);

      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });
  }

  // ─────────────────────────────────────────────
  // SHOP
  // ─────────────────────────────────────────────
  function renderShop(d) {
    var list = document.getElementById("shop-list");
    if (!list || !d.rewards) return;
    clearEl(list);

    for (var rewardId in d.rewards) {
      if (!Object.prototype.hasOwnProperty.call(d.rewards, rewardId)) continue;
      var reward     = d.rewards[rewardId];
      var canAfford  = d.current_month_xp >= reward.cost;
      var card = el("div", { className: "card card-glow p-4 flex items-center justify-between gap-3" });

      var left = el("div", { className: "flex-1 min-w-0" });
      left.appendChild(el("div", { className: "font-semibold text-sm", textContent: reward.name }));
      left.appendChild(el("div", { className: "text-xs mt-0.5", textContent: reward.description, style: { color: "var(--text-muted)" } }));

      var right = el("div", { className: "flex flex-col items-end gap-2 flex-shrink-0" });
      right.appendChild(el("div", {
        className: "font-game text-sm font-bold",
        textContent: reward.cost + " 🪙",
        style: { color: canAfford ? "#f59e0b" : "var(--text-muted)" },
      }));
      var buyBtn = el("button", {
        className: "btn-primary text-white text-xs px-4 py-1.5" + (canAfford ? "" : " opacity-40"),
        textContent: "Купить",
      });
      if (canAfford) {
        (function (rid) {
          buyBtn.addEventListener("click", function () {
            haptic("impact", "heavy");
            withLock(function () { return doBuyReward(rid); });
          });
        }(rewardId));
      }
      right.appendChild(buyBtn);
      card.appendChild(left);
      card.appendChild(right);
      list.appendChild(card);
    }
  }

  // ─────────────────────────────────────────────
  // JOURNAL
  // ─────────────────────────────────────────────
  async function loadJournal() {
    var list = document.getElementById("journal-list");
    if (!list) return;
    clearEl(list);
    list.appendChild(el("div", { className: "text-sm text-center py-8", textContent: "Загрузка...", style: { color: "var(--text-muted)" } }));
    try {
      var data = await apiGet("/api/history");
      clearEl(list);
      if (!data.history || data.history.length === 0) {
        list.appendChild(el("div", { className: "text-sm text-center py-8", textContent: "История пуста", style: { color: "var(--text-muted)" } }));
        return;
      }
      data.history.forEach(function (record) { list.appendChild(buildJournalItem(record)); });
    } catch (e) {
      clearEl(list);
      list.appendChild(el("div", { className: "text-sm text-center py-8 text-red-400", textContent: "Ошибка загрузки" }));
    }
  }

  function buildJournalItem(record) {
    var icon    = EVENT_ICONS[record.event_type] || "📌";
    var dt      = new Date(record.timestamp);
    var timeStr = dt.toLocaleString("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    var row     = el("div", { className: "card p-3 flex items-center gap-3" });
    var mid     = el("div", { className: "flex-1 min-w-0" });
    mid.appendChild(el("div", { className: "text-sm truncate", textContent: record.description }));
    mid.appendChild(el("div", { className: "text-xs mt-0.5", textContent: timeStr, style: { color: "var(--text-muted)" } }));
    var right = el("div", { className: "text-xs flex-shrink-0 flex flex-col items-end gap-0.5" });
    if (record.xp_delta !== 0) {
      right.appendChild(el("span", {
        className: record.xp_delta > 0 ? "text-blue-400" : "text-red-400",
        textContent: (record.xp_delta > 0 ? "+" : "") + record.xp_delta + " XP",
      }));
    }
    if (record.hp_delta !== 0) {
      right.appendChild(el("span", {
        className: record.hp_delta > 0 ? "text-green-400" : "text-red-400",
        textContent: (record.hp_delta > 0 ? "+" : "") + record.hp_delta + " HP",
      }));
    }
    row.appendChild(el("span", { className: "text-xl flex-shrink-0", textContent: icon }));
    row.appendChild(mid);
    row.appendChild(right);
    return row;
  }

  // ─────────────────────────────────────────────
  // ACTIONS
  // ─────────────────────────────────────────────
  async function doAddWater() {
    var data = await apiPost("/api/water", { amount: 1 });
    heroData = data.hero; heroLastFetch = Date.now();
    renderHero(data.hero);
    haptic("notification", "success");
    showToast("💧 +" + data.xp_gained + " XP  +" + data.hp_gained + " HP", "success");
  }

  async function doSleep() {
    if (heroData && heroData.sleep_start) {
      var data = await apiPost("/api/sleep/end", {});
      heroData = data.hero; heroLastFetch = Date.now();
      renderHero(data.hero);
      haptic("notification", "success");
      showToast("😴 " + data.message + "  +" + data.xp_gained + " XP", "success");
    } else {
      var data2 = await apiPost("/api/sleep/start", {});
      if (heroData) heroData.sleep_start = data2.sleep_start;
      renderSleepState(data2.sleep_start);
      haptic("notification", "success");
      showToast("Спокойной ночи! 🌙", "success");
    }
  }

  async function doCompleteTask(taskId) {
    var data = await apiPost("/api/task/complete", { task_id: taskId });
    heroData = data.hero; heroLastFetch = Date.now();
    renderHero(data.hero);
    haptic("notification", "success");
    showToast("✅ +" + data.xp_gained + " XP", "success");
  }

  async function doBuyReward(rewardId) {
    var data = await apiPost("/api/shop/buy", { reward_id: rewardId });
    heroData = data.hero; heroLastFetch = Date.now();
    renderHero(data.hero);
    haptic("notification", "success");
    showToast("🎉 Куплено: " + data.purchased, "success");
  }

  async function doSaveBio() {
    var weightInput = document.getElementById("bio-weight");
    var weight = parseFloat(weightInput.value);
    if (!weight || weight <= 0 || weight > 500) {
      showToast("Введите корректный вес", "error"); return;
    }
    var data = await apiPost("/api/bio/update", { weight: weight, activity_factor: selectedActivityFactor });
    heroData = data.hero; heroLastFetch = Date.now();
    renderHero(data.hero);
    weightInput.dataset.dirty = "";
    haptic("notification", "success");
    showToast("Биометрия сохранена ✅", "success");
  }

  async function doAddHabit(name, xp, category) {
    var data = await apiPost("/api/habit/add", { name: name, xp: xp, category: category });
    heroData = data.hero; heroLastFetch = Date.now();
    renderHero(data.hero); closeModal();
    haptic("notification", "success");
    showToast("Привычка добавлена!", "success");
  }

  async function doEditHabit(habitId, name, xp) {
    var data = await apiPost("/api/habit/edit", { habit_id: habitId, name: name, xp: xp });
    heroData = data.hero; heroLastFetch = Date.now();
    renderHero(data.hero); closeModal();
    haptic("notification", "success");
    showToast("Привычка обновлена!", "success");
  }

  async function doDeleteHabit(habitId) {
    var data = await apiPost("/api/habit/delete", { habit_id: habitId });
    heroData = data.hero; heroLastFetch = Date.now();
    renderHero(data.hero); closeModal();
    haptic("impact", "heavy");
    showToast("Привычка удалена", "info");
  }

  // ─────────────────────────────────────────────
  // MODALS
  // ─────────────────────────────────────────────
  function openModal() { document.getElementById("modal-overlay").classList.remove("hidden"); }
  function closeModal() {
    document.getElementById("modal-overlay").classList.add("hidden");
    clearEl(document.getElementById("modal-box"));
  }

  function makeInput(labelText, inputType, placeholder, value, min, max) {
    var attrs = {
      type: inputType,
      className: "w-full rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500",
      style: { background: "rgba(255,255,255,.07)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.1)" },
    };
    if (placeholder) attrs.placeholder = placeholder;
    if (value !== undefined && value !== null) attrs.value = String(value);
    if (min !== undefined) attrs.min = String(min);
    if (max !== undefined) attrs.max = String(max);
    if (inputType === "text") attrs.maxlength = "100";
    var lbl = el("label", { className: "block text-xs mb-1", textContent: labelText, style: { color: "var(--text-muted)" } });
    var inp = el("input", attrs);
    return { lbl: lbl, inp: inp };
  }

  function openAddHabitModal() {
    var box = document.getElementById("modal-box");
    clearEl(box);
    box.appendChild(el("div", { className: "font-game font-bold text-base mb-4", textContent: "✨ Новая привычка" }));
    var n = makeInput("Название", "text", "Пробежка 3км");
    var x = makeInput("XP за выполнение", "number", "25", null, 1, 200);
    var catLbl = el("label", { className: "block text-xs mb-1", textContent: "Категория", style: { color: "var(--text-muted)" } });
    var catSel = el("select", {
      className: "w-full rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500",
      style: { background: "rgba(22,27,34,1)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,.1)" },
    });
    [["activity","🏃 Активность"],["relations","🤝 Отношения"],["custom","✨ Своя"]].forEach(function (o) {
      catSel.appendChild(el("option", { value: o[0], textContent: o[1] }));
    });
    var btnRow  = el("div", { className: "flex gap-2" });
    var cancelB = el("button", { className: "btn-secondary flex-1 py-2.5 text-sm", textContent: "Отмена" });
    var addB    = el("button", { className: "btn-primary flex-1 py-2.5 text-sm text-white", textContent: "Добавить" });
    cancelB.addEventListener("click", closeModal);
    addB.addEventListener("click", function () {
      withLock(async function () {
        var name = n.inp.value.trim();
        var xp   = parseInt(x.inp.value, 10);
        if (!name)         { showToast("Введите название", "error"); return; }
        if (!xp || xp <= 0){ showToast("XP должно быть > 0", "error"); return; }
        await doAddHabit(name, xp, catSel.value);
      });
    });
    btnRow.appendChild(cancelB); btnRow.appendChild(addB);
    box.appendChild(n.lbl); box.appendChild(n.inp);
    box.appendChild(x.lbl); box.appendChild(x.inp);
    box.appendChild(catLbl); box.appendChild(catSel);
    box.appendChild(btnRow);
    openModal();
    n.inp.focus();
  }

  function openEditHabitModal(habit) {
    var box = document.getElementById("modal-box");
    clearEl(box);
    box.appendChild(el("div", { className: "font-game font-bold text-base mb-4", textContent: "✏️ Редактировать привычку" }));
    var n = makeInput("Название", "text", "", habit.name);
    var x = makeInput("XP", "number", "", habit.xp, 1, 200);
    x.inp.style.marginBottom = "16px";
    var btnRow  = el("div", { className: "flex gap-2 mb-3" });
    var cancelB = el("button", { className: "btn-secondary flex-1 py-2.5 text-sm", textContent: "Отмена" });
    var saveB   = el("button", { className: "btn-primary flex-1 py-2.5 text-sm text-white", textContent: "Сохранить" });
    cancelB.addEventListener("click", closeModal);
    saveB.addEventListener("click", function () {
      withLock(async function () {
        var name = n.inp.value.trim();
        var xp   = parseInt(x.inp.value, 10);
        if (!name)         { showToast("Введите название", "error"); return; }
        if (!xp || xp <= 0){ showToast("XP должно быть > 0", "error"); return; }
        await doEditHabit(habit.id, name, xp);
      });
    });
    btnRow.appendChild(cancelB); btnRow.appendChild(saveB);
    var delB = el("button", {
      className: "w-full py-2.5 text-sm rounded-xl font-semibold",
      textContent: "🗑️ Удалить привычку",
      style: { background: "rgba(239,68,68,.15)", color: "#f87171", border: "1px solid rgba(239,68,68,.2)" },
    });
    (function (id) {
      delB.addEventListener("click", function () { withLock(function () { return doDeleteHabit(id); }); });
    }(habit.id));
    box.appendChild(n.lbl); box.appendChild(n.inp);
    box.appendChild(x.lbl); box.appendChild(x.inp);
    box.appendChild(btnRow); box.appendChild(delB);
    openModal();
    n.inp.focus();
  }

  // ─────────────────────────────────────────────
  // BIO — activity selector & water calc
  // ─────────────────────────────────────────────
  function renderActivitySelector() {
    var container = document.getElementById("activity-selector");
    if (!container) return;
    clearEl(container);
    ACTIVITY_OPTIONS.forEach(function (opt) {
      var isSelected = Math.abs(opt.value - selectedActivityFactor) < 0.01;
      var btn = el("button", { className: "btn-secondary p-3 text-left rounded-xl transition-all" });
      if (isSelected) { btn.style.borderColor = "rgba(99,102,241,.6)"; btn.style.background = "rgba(99,102,241,.15)"; }
      btn.appendChild(el("div", { className: "text-sm font-semibold", textContent: opt.label }));
      btn.appendChild(el("div", { className: "text-xs mt-0.5", textContent: opt.sub, style: { color: "var(--text-muted)" } }));
      (function (v) {
        btn.addEventListener("click", function () {
          haptic("selection");
          selectedActivityFactor = v;
          renderActivitySelector();
          updateWaterCalc();
        });
      }(opt.value));
      container.appendChild(btn);
    });
  }

  function updateWaterCalc() {
    var weightInput = document.getElementById("bio-weight");
    var calcEl      = document.getElementById("bio-water-calc");
    if (!weightInput || !calcEl) return;
    var weight = parseFloat(weightInput.value) || (heroData ? heroData.weight : 70);
    calcEl.textContent = String(Math.max(1, Math.round(weight * selectedActivityFactor / 250)));
  }

  // ─────────────────────────────────────────────
  // ACCORDIONS
  // ─────────────────────────────────────────────
  function setupAccordion(btnId, bodyId, arrowId) {
    var btn   = document.getElementById(btnId);
    var body  = document.getElementById(bodyId);
    var arrow = document.getElementById(arrowId);
    if (!btn || !body) return;
    var open = false;
    btn.addEventListener("click", function () {
      haptic("selection");
      open = !open;
      if (open) {
        body.style.height = body.scrollHeight + "px";
        if (arrow) { arrow.style.transform = "rotate(90deg)"; arrow.style.transition = "transform .3s"; }
        requestAnimationFrame(function () { body.style.height = body.scrollHeight + "px"; });
      } else {
        body.style.height = "0px";
        if (arrow) arrow.style.transform = "rotate(0deg)";
      }
    });
  }

  // ─────────────────────────────────────────────
  // TABS
  // ─────────────────────────────────────────────
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.add("hidden"); });
    document.querySelectorAll(".nav-btn").forEach(function (b) { b.classList.remove("active"); });
    var panel  = document.getElementById("tab-" + tab);
    var navBtn = document.querySelector(".nav-btn[data-tab='" + tab + "']");
    if (panel)  panel.classList.remove("hidden");
    if (navBtn) navBtn.classList.add("active");
    if (tab === "path" || tab === "bio" || tab === "shop") {
      loadHero().catch(function (e) { showToast(e.message, "error"); });
    } else if (tab === "journal") {
      loadJournal();
    }
  }

  // ─────────────────────────────────────────────
  // SPLASH
  // ─────────────────────────────────────────────
  function showSplashError(msg) {
    var statusEl  = document.getElementById("splash-status");
    var reloadBtn = document.getElementById("splash-reload-btn");
    var loader    = document.getElementById("splash-loader");
    if (statusEl)  statusEl.textContent = msg;
    if (loader)    loader.style.display = "none";
    if (reloadBtn) {
      reloadBtn.classList.remove("hidden");
      reloadBtn.addEventListener("click", function () { location.reload(); }, { once: true });
    }
  }

  function hideSplash() {
    var splash = document.getElementById("splash");
    var appEl  = document.getElementById("app");
    if (splash) {
      splash.classList.add("hidden");
      setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 500);
    }
    if (appEl) appEl.classList.remove("hidden");
  }

  // ─────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────
  async function init() {
    // Grab Telegram WebApp object
    tgApp = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

    if (tgApp) {
      // ⚡ PER OFFICIAL DOCS: call ready() AS EARLY AS POSSIBLE
      // This hides the native Telegram loading spinner and shows the Mini App.
      // Must be called before any async operations.
      tgApp.ready();

      // Expand Mini App to full available height
      tgApp.expand();

      // Bot API 7.7+: disable vertical swipe to prevent accidental close
      if (tgApp.isVersionAtLeast && tgApp.isVersionAtLeast("7.7")) {
        tgApp.disableVerticalSwipes();
      }

      // Bot API 6.2+: ask confirmation before closing
      if (tgApp.isVersionAtLeast && tgApp.isVersionAtLeast("6.2")) {
        tgApp.enableClosingConfirmation();
      }

      // Bot API 6.1+: match header/bg colors to dark theme
      try {
        if (tgApp.isVersionAtLeast && tgApp.isVersionAtLeast("6.1")) {
          tgApp.setHeaderColor("#0c1017");
          tgApp.setBackgroundColor("#0c1017");
        }
        // Bot API 7.10+: bottom bar color
        if (tgApp.isVersionAtLeast && tgApp.isVersionAtLeast("7.10")) {
          tgApp.setBottomBarColor("#0c1017");
        }
      } catch (_) {}

      // initData = raw string for backend HMAC validation (trusted)
      // initDataUnsafe = pre-parsed but NOT trusted (display only)
      initData = tgApp.initData || "";

    } else {
      initData = "";
      console.warn("[LifeRPG] No Telegram.WebApp — running in dev/browser mode");
    }

    // Setup UI
    setupAccordion("accordion-activity-btn", "accordion-activity-body", "arrow-activity");
    setupAccordion("accordion-relations-btn", "accordion-relations-body", "arrow-relations");
    setupAccordion("accordion-custom-btn",    "accordion-custom-body",   "arrow-custom");

    // Bottom navigation
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        haptic("selection");
        var tab = btn.getAttribute("data-tab");
        if (tab) switchTab(tab);
      });
    });

    // Close modal on backdrop click
    document.getElementById("modal-overlay").addEventListener("click", function (e) {
      if (e.target === document.getElementById("modal-overlay")) closeModal();
    });

    // Bio weight input
    var bioWeight = document.getElementById("bio-weight");
    if (bioWeight) {
      bioWeight.addEventListener("input", function () {
        bioWeight.dataset.dirty = "1";
        updateWaterCalc();
      });
    }

    // Buttons
    document.getElementById("btn-water").addEventListener("click", function () {
      haptic("impact", "light");
      withLock(doAddWater);
    });
    document.getElementById("btn-sleep").addEventListener("click", function () {
      haptic("impact", "medium");
      withLock(doSleep);
    });
    document.getElementById("btn-bio-save").addEventListener("click", function () {
      haptic("impact", "medium");
      withLock(doSaveBio);
    });
    document.getElementById("btn-add-habit").addEventListener("click", function () {
      haptic("selection");
      openAddHabitModal();
    });

    // Tab visibility change — refresh hero with TTL cache
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && (currentTab === "path" || currentTab === "shop")) {
        loadHero().catch(function () {});
      }
    });

    // Load first data
    var splashStatus = document.getElementById("splash-status");
    if (splashStatus) splashStatus.textContent = "Загрузка героя...";

    try {
      await loadHero(true);
      renderActivitySelector();
      hideSplash();
      switchTab("path");
    } catch (e) {
      console.error("[LifeRPG] init failed:", e);
      showSplashError("Ошибка подключения. Проверьте сеть.");
    }
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
