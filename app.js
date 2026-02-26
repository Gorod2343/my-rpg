// app.js - внутри init() или отдельной функции setupTheme
function setupTheme() {
    const theme = tg.themeParams;
    // Устанавливаем CSS-переменные для всего приложения
    const root = document.documentElement;
    root.style.setProperty('--bg-color', theme.bg_color || '#0c1017');
    root.style.setProperty('--card-bg', theme.secondary_bg_color || '#161b22');
    root.style.setProperty('--text-color', theme.text_color || '#e5e7eb');
    root.style.setProperty('--hint-color', theme.hint_color || '#9ca3af');
    root.style.setProperty('--link-color', theme.link_color || '#3b82f6');
    root.style.setProperty('--button-color', theme.button_color || '#3b82f6');
    root.style.setProperty('--button-text-color', theme.button_text_color || '#ffffff');

    // Также можно установить цвета для конкретных элементов, например для кнопок
}

// Подписаться на изменение темы
tg.onEvent('themeChanged', setupTheme);
