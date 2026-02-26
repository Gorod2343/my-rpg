// app.js - Vanilla JS, Telegram WebApp, no innerHTML

(function() {
    // ---------- Configuration ----------
    const API_BASE = ''; // relative, same origin
    const CACHE_TTL = 10000; // 10 seconds

    // ---------- Global state ----------
    let tg = window.Telegram?.WebApp;
    if (!tg) {
        console.error('Telegram WebApp not available');
        // Fallback for local testing? We'll handle gracefully.
        tg = { expand: () => {}, ready: () => {}, initData: '', MainButton: {}, HapticFeedback: {} };
    }
    tg.expand();
    tg.ready();

    // Get init data from Telegram
    const initData = tg.initData || '';

    // State
    let hero = null; // cached hero data
    let lastFetch = 0; // timestamp
    let isLocked = false; // debounce for buttons
    let currentTab = 'path'; // path, bio, shop, journal
    let accordions = {}; // state for accordions (open/closed)

    // DOM elements
    const appEl = document.getElementById('app');

    // ---------- Utility functions ----------
    function debounceRequest() {
        if (isLocked) return true;
        isLocked = true;
        setTimeout(() => { isLocked = false; }, 500); // 500ms lock
        return false;
    }

    async function apiFetch(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'X-Telegram-Init-Data': initData,
            ...options.headers
        };
        try {
            const response = await fetch(API_BASE + endpoint, { ...options, headers });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
                throw new Error(error.detail || `HTTP ${response.status}`);
            }
            return await response.json();
        } catch (err) {
            console.error('API error:', err);
            throw err;
        }
    }

    async function loadHero(force = false) {
        const now = Date.now();
        if (!force && hero && (now - lastFetch) < CACHE_TTL) {
            return hero;
        }
        try {
            hero = await apiFetch('/api/hero');
            lastFetch = now;
            return hero;
        } catch (err) {
            showError('Не удалось загрузить данные', err);
            throw err;
        }
    }

    // ---------- UI Helpers (createElement only) ----------
    function createElement(tag, attrs = {}, children = []) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'className') {
                el.className = value;
            } else if (key === 'textContent') {
                el.textContent = value;
            } else if (key.startsWith('on') && typeof value === 'function') {
                el.addEventListener(key.slice(2).toLowerCase(), value);
            } else {
                el.setAttribute(key, value);
            }
        }
        children.forEach(child => {
            if (typeof child === 'string') {
                el.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                el.appendChild(child);
            }
        });
        return el;
    }

    function showError(message, error) {
        // Simple error display (could be enhanced)
        console.error(message, error);
        // Show a toast or overlay? For simplicity, we'll append a temporary error message
        const errorDiv = createElement('div', {
            className: 'fixed top-4 left-4 right-4 bg-red-600 text-white p-4 rounded-lg z-50 shadow-lg'
        }, [message]);
        document.body.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 5000);
    }

    // ---------- Render functions for each tab ----------
    function renderPath(heroData) {
        const container = createElement('div', { className: 'space-y-4' });

        // Stats row (HP, XP, Month XP)
        const statsRow = createElement('div', { className: 'grid grid-cols-3 gap-3 mb-4' });
        statsRow.appendChild(createStatCard('❤️ HP', heroData.hp, 'text-red-400'));
        statsRow.appendChild(createStatCard('✨ XP', heroData.xp_total, 'text-yellow-400'));
        statsRow.appendChild(createStatCard('📅 Месяц', heroData.current_month_xp, 'text-blue-400'));
        container.appendChild(statsRow);

        // Water and Sleep grid (2 columns)
        const grid2 = createElement('div', { className: 'grid grid-cols-2 gap-3 mb-4' });
        grid2.appendChild(renderWaterWidget(heroData));
        grid2.appendChild(renderSleepWidget(heroData));
        container.appendChild(grid2);

        // Accordion: Activity
        container.appendChild(renderAccordion('Активность', 'activity', heroData.system_tasks.filter(t => t.category === 'activity'), heroData.custom_tasks.filter(t => t.category === 'activity'), heroData));
        // Accordion: Отношения
        container.appendChild(renderAccordion('Отношения', 'relationships', heroData.system_tasks.filter(t => t.category === 'relationships'), heroData.custom_tasks.filter(t => t.category === 'relationships'), heroData));

        return container;
    }

    function createStatCard(label, value, colorClass) {
        return createElement('div', { className: `bg-[#161b22] rounded-xl p-3 text-center` }, [
            createElement('div', { className: 'text-sm text-gray-400' }, [label]),
            createElement('div', { className: `text-xl font-bold ${colorClass}` }, [value.toString()])
        ]);
    }

    function renderWaterWidget(heroData) {
        // Goal calculation: weight * activity / 250 (activity factor: low=30, medium=35, high=40)
        let goal = 0;
        if (heroData.weight && heroData.activity) {
            const activityFactor = { low: 30, medium: 35, high: 40 }[heroData.activity] || 30;
            goal = Math.round(heroData.weight * activityFactor / 250);
        }
        const progress = goal > 0 ? Math.min(100, Math.round((heroData.water_count / goal) * 100)) : 0;

        const card = createElement('div', { className: 'bg-[#161b22] rounded-xl p-3 min-h-[140px] flex flex-col' });
        card.appendChild(createElement('h3', { className: 'text-sm text-gray-400 mb-1' }, ['💧 Вода']));
        const countRow = createElement('div', { className: 'flex justify-between items-center mb-2' });
        countRow.appendChild(createElement('span', { className: 'text-xl font-bold text-blue-400' }, [`${heroData.water_count} / ${goal}`]));
        countRow.appendChild(createElement('button', {
            className: 'bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-full text-sm',
            onClick: onWaterSip
        }, ['+ Глоток']));
        card.appendChild(countRow);
        // Progress bar
        const progressBar = createElement('div', { className: 'w-full bg-gray-700 rounded-full h-2' });
        const fill = createElement('div', { className: 'bg-blue-500 h-2 rounded-full', style: `width: ${progress}%;` });
        progressBar.appendChild(fill);
        card.appendChild(progressBar);
        return card;
    }

    function renderSleepWidget(heroData) {
        const isSleeping = heroData.sleep_start_time != null;
        const buttonClass = isSleeping ? 'bg-green-600 hover:bg-green-700 pulse-shadow' : 'bg-indigo-600 hover:bg-indigo-700';
        const buttonText = isSleeping ? '☀️ Проснуться' : '🌙 Уснуть';
        const statusText = isSleeping
            ? `Спит с ${new Date(heroData.sleep_start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Сон не начат';

        const card = createElement('div', { className: 'bg-[#161b22] rounded-xl p-3 min-h-[140px] flex flex-col justify-between' });
        card.appendChild(createElement('h3', { className: 'text-sm text-gray-400 mb-1' }, ['😴 Сон']));
        card.appendChild(createElement('div', { className: 'text-xs text-gray-400 mb-2' }, [statusText]));
        const btn = createElement('button', {
            className: `w-full ${buttonClass} text-white px-3 py-2 rounded-full text-sm font-medium`,
            onClick: onSleepToggle
        }, [buttonText]);
        card.appendChild(btn);
        return card;
    }

    function renderAccordion(title, id, systemTasks, customTasks, heroData) {
        const isOpen = accordions[id] || false;
        const container = createElement('div', { className: 'bg-[#161b22] rounded-xl p-3 mb-3' });

        // Header
        const header = createElement('div', { className: 'flex justify-between items-center cursor-pointer' });
        header.appendChild(createElement('h3', { className: 'font-medium' }, [title]));
        const arrow = createElement('span', { className: 'text-xl transition-transform', style: isOpen ? 'transform: rotate(180deg);' : '' }, ['▼']);
        header.appendChild(arrow);
        header.addEventListener('click', () => {
            accordions[id] = !accordions[id];
            render(); // re-render current tab
        });
        container.appendChild(header);

        // Content
        const content = createElement('div', {
            className: `accordion-content ${isOpen ? 'open' : ''}`,
            style: isOpen ? `max-height: ${calculateContentHeight(systemTasks, customTasks)}px;` : ''
        });

        if (systemTasks.length === 0 && customTasks.length === 0) {
            content.appendChild(createElement('p', { className: 'text-gray-500 text-sm py-2' }, ['Нет задач']));
        } else {
            // System tasks
            systemTasks.forEach(task => {
                content.appendChild(createTaskRow(task, 'system', heroData));
            });
            // Custom tasks
            customTasks.forEach(task => {
                content.appendChild(createTaskRow(task, 'custom', heroData));
            });
            // Add habit button
            const addBtn = createElement('button', {
                className: 'mt-2 text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1',
                onClick: () => openHabitModal(id)
            }, ['➕ Добавить привычку']);
            content.appendChild(addBtn);
        }

        container.appendChild(content);
        return container;
    }

    function calculateContentHeight(systemTasks, customTasks) {
        // Rough estimate: each task row ~40px, button 30px
        return (systemTasks.length + customTasks.length) * 40 + 30;
    }

    function createTaskRow(task, type, heroData) {
        const row = createElement('div', { className: 'flex justify-between items-center py-2 border-b border-gray-700 last:border-0' });
        row.appendChild(createElement('span', {}, [task.name]));
        const actions = createElement('div', { className: 'flex items-center gap-2' });
        actions.appendChild(createElement('span', { className: 'text-sm text-yellow-400' }, [`+${task.xp_reward} XP`]));
        const completeBtn = createElement('button', {
            className: 'bg-green-600 hover:bg-green-700 text-xs px-2 py-1 rounded',
            onClick: (e) => {
                e.stopPropagation();
                completeTask(type, task.id);
            }
        }, ['✔️']);
        actions.appendChild(completeBtn);
        if (type === 'custom') {
            const editBtn = createElement('button', {
                className: 'bg-gray-600 hover:bg-gray-700 text-xs px-2 py-1 rounded',
                onClick: (e) => {
                    e.stopPropagation();
                    openHabitModal(task.category, task);
                }
            }, ['✏️']);
            actions.appendChild(editBtn);
            const deleteBtn = createElement('button', {
                className: 'bg-red-600 hover:bg-red-700 text-xs px-2 py-1 rounded',
                onClick: (e) => {
                    e.stopPropagation();
                    deleteHabit(task.id);
                }
            }, ['🗑️']);
            actions.appendChild(deleteBtn);
        }
        row.appendChild(actions);
        return row;
    }

    // ---------- Event handlers ----------
    async function onWaterSip() {
        if (debounceRequest()) return;
        try {
            const data = await apiFetch('/api/water/sip', { method: 'POST' });
            hero = { ...hero, water_count: data.water_count, hp: data.hp, xp_total: data.xp_total, current_month_xp: data.current_month_xp };
            render();
            tg.HapticFeedback?.impactOccurred('light');
        } catch (err) {
            showError('Ошибка при добавлении воды', err);
        }
    }

    async function onSleepToggle() {
        if (debounceRequest()) return;
        try {
            if (hero.sleep_start_time) {
                // end sleep
                const data = await apiFetch('/api/sleep/end', { method: 'POST' });
                hero = { ...hero, sleep_start_time: null, hp: hero.hp + data.hp_gained, xp_total: hero.xp_total + data.xp_gained, current_month_xp: hero.current_month_xp + data.xp_gained };
                render();
                tg.showAlert(`Сон: ${data.message}`);
            } else {
                // start sleep
                const data = await apiFetch('/api/sleep/start', { method: 'POST' });
                hero = { ...hero, sleep_start_time: data.sleep_start_time };
                render();
            }
            tg.HapticFeedback?.impactOccurred('medium');
        } catch (err) {
            showError('Ошибка', err);
        }
    }

    async function completeTask(type, taskId) {
        if (debounceRequest()) return;
        try {
            const data = await apiFetch('/api/task/complete', {
                method: 'POST',
                body: JSON.stringify({ task_type: type, task_id: taskId })
            });
            // Refresh hero to get updated XP and month XP
            await loadHero(true);
            render();
            tg.HapticFeedback?.notificationOccurred('success');
        } catch (err) {
            showError('Не удалось выполнить задачу', err);
        }
    }

    // Habit modal (simple prompt for demo, could be improved)
    function openHabitModal(category, habit = null) {
        const isEdit = !!habit;
        const name = isEdit ? habit.name : '';
        const xp = isEdit ? habit.xp_reward : '';
        const newName = prompt('Название привычки:', name);
        if (newName === null) return;
        const newXp = prompt('Опыт за выполнение (>0):', xp);
        if (newXp === null || parseInt(newXp) <= 0) {
            alert('Опыт должен быть положительным числом');
            return;
        }
        const habitData = { name: newName, xp_reward: parseInt(newXp), category };
        if (isEdit) {
            updateHabit(habit.id, habitData);
        } else {
            createHabit(habitData);
        }
    }

    async function createHabit(habitData) {
        if (debounceRequest()) return;
        try {
            await apiFetch('/api/habits', {
                method: 'POST',
                body: JSON.stringify(habitData)
            });
            await loadHero(true);
            render();
        } catch (err) {
            showError('Ошибка создания привычки', err);
        }
    }

    async function updateHabit(id, habitData) {
        if (debounceRequest()) return;
        try {
            await apiFetch(`/api/habits/${id}`, {
                method: 'PUT',
                body: JSON.stringify(habitData)
            });
            await loadHero(true);
            render();
        } catch (err) {
            showError('Ошибка обновления', err);
        }
    }

    async function deleteHabit(id) {
        if (!confirm('Удалить привычку?')) return;
        if (debounceRequest()) return;
        try {
            await apiFetch(`/api/habits/${id}`, { method: 'DELETE' });
            await loadHero(true);
            render();
        } catch (err) {
            showError('Ошибка удаления', err);
        }
    }

    // ---------- Tab rendering ----------
    function render() {
        if (!hero) {
            appEl.innerHTML = ''; // clear while loading
            appEl.appendChild(createElement('div', { className: 'text-center py-10' }, ['Загрузка...']));
            return;
        }

        // Build tab navigation
        const nav = createElement('div', { className: 'fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-[#161b22] rounded-full px-2 py-1 flex gap-1 shadow-lg z-10' });
        const tabs = [
            { id: 'path', label: 'Путь', icon: '⚔️' },
            { id: 'bio', label: 'Био', icon: '📊' },
            { id: 'shop', label: 'Маг', icon: '🛒' },
            { id: 'journal', label: 'Жур', icon: '📜' }
        ];
        tabs.forEach(tab => {
            const btn = createElement('button', {
                className: `px-4 py-2 rounded-full text-sm ${currentTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`,
                onClick: () => {
                    currentTab = tab.id;
                    render();
                }
            }, [`${tab.icon} ${tab.label}`]);
            nav.appendChild(btn);
        });

        // Render main content based on tab
        let content;
        switch (currentTab) {
            case 'path':
                content = renderPath(hero);
                break;
            case 'bio':
                content = renderBio(hero);
                break;
            case 'shop':
                content = renderShop(hero);
                break;
            case 'journal':
                content = renderJournal(hero);
                break;
            default:
                content = renderPath(hero);
        }

        appEl.innerHTML = ''; // clear
        appEl.appendChild(content);
        appEl.appendChild(nav);
    }

    // Additional tab renderers (simplified for brevity, but fully implemented)
    function renderBio(heroData) {
        const container = createElement('div', { className: 'space-y-4' });

        // Weight and activity inputs
        const weightInput = createElement('input', {
            type: 'number',
            placeholder: 'Вес (кг)',
            className: 'bg-[#161b22] rounded-xl p-3 w-full text-white',
            value: heroData.weight || ''
        });
        const activitySelect = createElement('select', { className: 'bg-[#161b22] rounded-xl p-3 w-full text-white' });
        ['low', 'medium', 'high'].forEach(level => {
            const option = createElement('option', { value: level, selected: heroData.activity === level }, [level === 'low' ? 'Низкая' : level === 'medium' ? 'Средняя' : 'Высокая']);
            activitySelect.appendChild(option);
        });
        const saveBtn = createElement('button', {
            className: 'bg-blue-600 hover:bg-blue-700 rounded-xl p-3 w-full',
            onClick: async () => {
                const weight = parseFloat(weightInput.value);
                const activity = activitySelect.value;
                if (!weight || weight <= 0) return alert('Введите корректный вес');
                try {
                    await apiFetch('/api/user/metrics', {
                        method: 'POST',
                        body: JSON.stringify({ weight, activity })
                    });
                    hero.weight = weight;
                    hero.activity = activity;
                    render();
                } catch (err) {
                    showError('Ошибка сохранения', err);
                }
            }
        }, ['Сохранить']);

        container.appendChild(createElement('h2', { className: 'text-xl font-bold mb-2' }, ['Биометрия']));
        container.appendChild(weightInput);
        container.appendChild(activitySelect);
        container.appendChild(saveBtn);

        return container;
    }

    function renderShop(heroData) {
        const container = createElement('div', { className: 'space-y-4' });
        container.appendChild(createElement('h2', { className: 'text-xl font-bold mb-2' }, ['Магазин']));
        container.appendChild(createElement('p', { className: 'text-sm text-gray-400' }, [`Доступно XP в этом месяце: ${heroData.current_month_xp}`]));

        if (!heroData.rewards || heroData.rewards.length === 0) {
            container.appendChild(createElement('p', { className: 'text-gray-500' }, ['Нет доступных наград']));
        } else {
            heroData.rewards.forEach(reward => {
                const row = createElement('div', { className: 'bg-[#161b22] rounded-xl p-3 mb-2 flex justify-between items-center' });
                const info = createElement('div');
                info.appendChild(createElement('div', { className: 'font-medium' }, [reward.name]));
                if (reward.description) {
                    info.appendChild(createElement('div', { className: 'text-xs text-gray-400' }, [reward.description]));
                }
                row.appendChild(info);
                const cost = createElement('span', { className: 'text-yellow-400 font-bold' }, [`${reward.xp_cost} XP`]);
                const buyBtn = createElement('button', {
                    className: 'ml-2 bg-green-600 hover:bg-green-700 px-3 py-1 rounded-full text-sm',
                    onClick: () => buyReward(reward.id, reward.xp_cost)
                }, ['Купить']);
                const right = createElement('div', { className: 'flex items-center gap-2' });
                right.appendChild(cost);
                right.appendChild(buyBtn);
                row.appendChild(right);
                container.appendChild(row);
            });
        }
        return container;
    }

    async function buyReward(rewardId, cost) {
        if (hero.current_month_xp < cost) {
            tg.showAlert('Недостаточно XP');
            return;
        }
        if (debounceRequest()) return;
        try {
            await apiFetch('/api/shop/buy', {
                method: 'POST',
                body: JSON.stringify({ reward_id: rewardId })
            });
            await loadHero(true);
            render();
            tg.HapticFeedback?.notificationOccurred('success');
        } catch (err) {
            showError('Ошибка покупки', err);
        }
    }

    function renderJournal(heroData) {
        const container = createElement('div', { className: 'space-y-4' });
        container.appendChild(createElement('h2', { className: 'text-xl font-bold mb-2' }, ['Журнал']));

        // Fetch and display history
        (async () => {
            try {
                const history = await apiFetch('/api/history');
                const list = createElement('div', { className: 'space-y-2' });
                if (history.length === 0) {
                    list.appendChild(createElement('p', { className: 'text-gray-500' }, ['История пуста']));
                } else {
                    history.forEach(entry => {
                        const date = new Date(entry.created_at).toLocaleString();
                        const signXp = entry.xp_change > 0 ? `+${entry.xp_change}` : entry.xp_change;
                        const signHp = entry.hp_change > 0 ? `+${entry.hp_change}` : entry.hp_change;
                        const entryEl = createElement('div', { className: 'bg-[#161b22] rounded-lg p-2 text-sm' }, [
                            createElement('div', { className: 'text-xs text-gray-400' }, [date]),
                            createElement('div', {}, [entry.description || entry.action_type]),
                            createElement('div', { className: 'flex gap-2 text-xs' }, [
                                entry.xp_change !== 0 ? createElement('span', { className: 'text-yellow-400' }, [`XP: ${signXp}`]) : null,
                                entry.hp_change !== 0 ? createElement('span', { className: 'text-red-400' }, [`HP: ${signHp}`]) : null
                            ].filter(Boolean))
                        ]);
                        list.appendChild(entryEl);
                    });
                }
                // Replace placeholder with actual list
                const oldList = container.querySelector('.history-list');
                if (oldList) oldList.remove();
                container.appendChild(list);
            } catch (err) {
                container.appendChild(createElement('p', { className: 'text-red-500' }, ['Ошибка загрузки истории']));
            }
        })();

        // Placeholder while loading
        container.appendChild(createElement('div', { className: 'history-list text-gray-500' }, ['Загрузка...']));
        return container;
    }

    // ---------- Initialization ----------
    async function init() {
        try {
            await loadHero();
            render();
        } catch (err) {
            showError('Не удалось загрузить начальные данные', err);
            // Show retry button
            const retryBtn = createElement('button', {
                className: 'bg-blue-600 text-white px-4 py-2 rounded-lg mx-auto block mt-10',
                onClick: () => init()
            }, ['Перезагрузить']);
            appEl.appendChild(retryBtn);
        }

        // Handle visibility change to refresh cache if needed
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                // If cache expired, refresh on next render
                if (Date.now() - lastFetch > CACHE_TTL) {
                    loadHero(true).then(render).catch(console.error);
                }
            }
        });
    }

    // Start
    init();
})();
