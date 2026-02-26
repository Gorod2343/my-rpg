const tg = window.Telegram.WebApp;
tg.expand();

let isLocked = false;
let heroCache = null;
let heroCacheTime = 0;

async function api(path, method="GET", body=null) {
    if (isLocked) return;
    isLocked = true;

    try {
        const res = await fetch(path, {
            method,
            headers: {
                "Content-Type": "application/json",
                "X-Telegram-Init-Data": tg.initData
            },
            body: body ? JSON.stringify(body) : null
        });
        return await res.json();
    } finally {
        setTimeout(() => { isLocked = false }, 500);
    }
}

async function loadHero() {
    const now = Date.now();
    if (heroCache && now - heroCacheTime < 10000) {
        return heroCache;
    }
    const data = await api("/hero");
    heroCache = data;
    heroCacheTime = now;
    return data;
}

function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
}

async function render() {
    const app = document.getElementById("app");
    app.textContent = "";

    const hero = await loadHero();

    const grid = el("div", "grid grid-cols-2 gap-4");

    const water = el("div", "bg-[#161b22] p-4 rounded-xl min-h-[140px] flex flex-col justify-between");
    const waterTitle = el("div");
    waterTitle.textContent = "Вода";
    const waterBtn = el("button", "bg-indigo-600 p-2 rounded");
    waterBtn.textContent = "Глоток";
    waterBtn.addEventListener("click", async () => {
        await api("/water", "POST");
        heroCache = null;
        render();
    });

    water.appendChild(waterTitle);
    water.appendChild(waterBtn);

    const sleep = el("div", "bg-[#161b22] p-4 rounded-xl min-h-[140px] flex flex-col justify-between");
    const sleepBtn = el("button", "bg-indigo-600 p-2 rounded");
    sleepBtn.textContent = "🌙 Уснуть";

    sleepBtn.addEventListener("click", async () => {
        const duration = 7.5;
        const bedtime_hour = new Date().getHours();
        await api("/sleep", "POST", {duration, bedtime_hour});
        heroCache = null;
        render();
    });

    sleep.appendChild(sleepBtn);

    grid.appendChild(water);
    grid.appendChild(sleep);

    app.appendChild(grid);
}

render();
