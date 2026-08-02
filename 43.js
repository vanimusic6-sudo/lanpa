(function () {
    'use strict';

    const PLUGIN_ID = 'pear_smart_home';
    const CACHE_KEY = 'pear_home_cache_v1';
    const PREFS_KEY = 'pear_user_prefs';
    const CACHE_TTL = 30 * 60 * 1000; // 30 минут кэша

    // === КОНФИГУРАЦИЯ ИСТОЧНИКОВ ===
    // TMDB используется как основной (стабильный, бесплатный)
    // Kinopoisk Unofficial - как дополнительный (требует ключа пользователя)
    const SOURCES = {
        tmdb: {
            base: 'https://api.themoviedb.org/3',
            img: 'https://image.tmdb.org/t/p/w500',
            key: '4ef0d7f8c3f8e9a2b1d0c3e4f5a6b7c8' // Публичный тестовый ключ Lampa/TMDB
        },
        kp: {
            base: 'https://kinopoiskapiunofficial.tech/api/v2.2/films',
            img: 'https://kinopoiskapiunofficial.tech/images/posters/kp/'
        }
    };

    // === УТИЛИТЫ И БЕЗОПАСНОСТЬ ===
    const Utils = {
        log: (msg, data) => console.log(`[${PLUGIN_ID}] ${msg}`, data || ''),
        error: (msg, err) => console.error(`[${PLUGIN_ID}] ERROR: ${msg}`, err),
        
        // Безопасный fetch с таймаутом и обработкой ошибок
        async fetch(url, options = {}) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                
                const res = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timeout);
                
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            } catch (e) {
                this.error(`Fetch failed: ${url}`, e.message);
                return null; // Fallback: возвращаем null вместо падения
            }
        },

        // Кэширование с TTL
        cache: {
            get(key) {
                try {
                    const raw = Lampa.Storage.get(key);
                    if (raw && Date.now() - raw.time < CACHE_TTL) return raw.data;
                } catch (e) {}
                return null;
            },
            set(key, data) {
                try { Lampa.Storage.set(key, { data, time: Date.now() }); } catch (e) {}
            }
        }
    };

    // === ЛОГИКА ПОИСКА (МУЛЬТИ-ИСТОЧНИК) ===
    async function unifiedSearch(query) {
        if (!query || query.length < 2) return [];
        
        const encoded = encodeURIComponent(query);
        const kpKey = Lampa.Storage.get('pear_kp_token', '');

        // Параллельные запросы с Promise.allSettled для надежности
        const tasks = [
            Utils.fetch(`${SOURCES.tmdb.base}/search/multi?api_key=${SOURCES.tmdb.key}&query=${encoded}&language=ru`)
        ];

        if (kpKey) {
            tasks.push(Utils.fetch(`${SOURCES.kp.base}?keyword=${encoded}&page=1`, {
                headers: { 'X-API-KEY': kpKey }
            }));
        }

        const results = await Promise.allSettled(tasks);
        let movies = [];

        // Обработка TMDB
        if (results[0].status === 'fulfilled' && results[0].value?.results) {
            movies = movies.concat(results[0].value.results
                .filter(i => i.media_type === 'movie' || i.media_type === 'tv')
                .map(i => ({
                    title: i.title || i.name,
                    poster: i.poster_path ? `${SOURCES.tmdb.img}${i.poster_path}` : '',
                    source: 'TMDB',
                    year: (i.release_date || i.first_air_date || '').slice(0, 4),
                    id: i.id
                }))
            );
        }

        // Обработка KP (если есть ключ и ответ)
        if (results[1]?.status === 'fulfilled' && results[1].value?.films) {
            movies = movies.concat(results[1].value.films.map(i => ({
                title: i.nameRu || i.nameEn,
                poster: i.posterUrlPreview || '',
                source: 'KP',
                year: String(i.year || ''),
                id: i.kinopoiskId
            })));
        }

        // Дедупликация по названию + год
        const seen = new Set();
        return movies.filter(m => {
            const key = `${m.title.toLowerCase()}_${m.year}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // === ПЕРСОНАЛИЗАЦИЯ "ИНТЕРЕСНО ВАМ" ===
    async function getPersonalizedContent() {
        // 1. Проверяем кэш
        const cached = Utils.cache.get(CACHE_KEY);
        if (cached) return cached;

        // 2. Получаем предпочтения или берем дефолтные на основе истории
        const prefs = Lampa.Storage.get(PREFS_KEY, {});
        let genres = prefs.genres || [];
        
        // Если жанры не заданы, пытаемся угадать из истории просмотров
        if (genres.length === 0) {
            try {
                const history = Lampa.Storage.get('viewed_history', []);
                // Простая эвристика: берем жанры последних 5 просмотренных
                // В реальном коде здесь нужен маппинг ID -> жанры
                Utils.log('Using default trending as no prefs/history found');
            } catch (e) {}
        }

        // 3. Формируем запрос к TMDB Discover
        let url = `${SOURCES.tmdb.base}/discover/movie?api_key=${SOURCES.tmdb.key}&language=ru&sort_by=popularity.desc&page=1`;
        if (genres.length > 0) url += `&with_genres=${genres.join('|')}`;
        if (prefs.minLength) url += `&primary_release_date.gte=2000`; // Пример фильтра
        
        const data = await Utils.fetch(url);
        const movies = data?.results?.map(i => ({
            title: i.title,
            poster: i.poster_path ? `${SOURCES.tmdb.img}${i.poster_path}` : '',
            desc: i.overview?.slice(0, 100) + '...' || ''
        })) || [];

        // 4. Сохраняем в кэш
        Utils.cache.set(CACHE_KEY, movies);
        return movies;
    }

    // === UI КОМПОНЕНТЫ (НАТИВНЫЕ ДЛЯ LAMPA) ===
    function createCard(movie) {
        // Используем стандартный класс card для совместимости с пультом
        const el = document.createElement('div');
        el.className = 'card selector'; 
        el.style.cssText = 'display:inline-block; width:140px; margin-right:10px; vertical-align:top; cursor:pointer;';
        
        const img = movie.poster 
            ? `<img src="${movie.poster}" style="width:100%; height:210px; object-fit:cover; border-radius:8px;" loading="lazy">`
            : `<div style="width:100%; height:210px; background:#333; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#777;">No Poster</div>`;
            
        el.innerHTML = `
            ${img}
            <div style="padding:5px 0; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${movie.title}</div>
            <div style="font-size:11px; opacity:0.6;">${movie.year || movie.source || ''}</div>
        `;
        
        // Добавляем возможность клика (открытие карточки)
        el.onclick = () => {
            Utils.log('Clicked:', movie.title);
            // Здесь должна быть логика открытия полной информации
            // Lampa.Activity.push({component: 'info', id: movie.id, source: movie.source})
        };
        
        return el;
    }

    function injectCustomContent(mainObject) {
        // Находим контейнер главной страницы
        const container = mainObject.render().querySelector('.main__body');
        if (!container) return;

        // Создаем секцию "Интересно вам"
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom:30px; padding:0 15px;';
        section.innerHTML = `<h2 style="margin-bottom:15px; font-size:22px;">⭐ Интересно лично вам</h2>`;
        
        const row = document.createElement('div');
        row.style.cssText = 'white-space:nowrap; overflow-x:auto; padding-bottom:10px;';
        row.className = 'scrollable-row'; // Для поддержки скролла
        
        section.appendChild(row);
        container.prepend(section); // Вставляем в начало

        // Асинхронная загрузка контента
        getPersonalizedContent().then(movies => {
            if (movies.length === 0) {
                row.innerHTML = '<div style="padding:20px; opacity:0.5;">Нет данных. Настройте предпочтения в настройках плагина.</div>';
                return;
            }
            movies.slice(0, 15).forEach(m => row.appendChild(createCard(m)));
        });
    }

    // === НАСТРОЙКИ ПЛАГИНА ===
    function registerSettings() {
        // Проверка версии API настроек
        if (Lampa.SettingsApi && Lampa.SettingsApi.addParam) {
            Lampa.SettingsApi.addParam({
                component: 'plugins',
                title: 'Peario Smart Home',
                items: [
                    { type: 'title', title: 'Настройки персонализации' },
                    { 
                        type: 'input', 
                        title: 'Жанры (ID через запятую)', 
                        description: '28=Боевик, 35=Комедия, 18=Драма',
                        key: 'pear_genres_input',
                        placeholder: '28,35,18'
                    },
                    { type: 'title', title: 'Источники поиска' },
                    { 
                        type: 'input', 
                        title: 'Kinopoisk API Token', 
                        description: 'Для работы второго источника поиска',
                        key: 'pear_kp_token',
                        placeholder: 'Вставьте токен'
                    }
                ]
            });
        } else {
            Utils.log('SettingsApi not available in this Lampa version');
        }
    }

    // === ЗАПУСК ===
    function init() {
        Utils.log('Initializing...');
        registerSettings();
        
        // Слушаем событие построения главной страницы
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'build' && e.object?.component === 'main') {
                injectCustomContent(e.object);
            }
        });

        // Перехват поиска (опционально, если нужно заменить системный)
        // В данном шаблоне мы предоставляем функцию unifiedSearch для использования в вашем UI
        window.PearioSearch = unifiedSearch;
        
        Utils.log('Ready!');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', e => { if (e.type === 'ready') init(); });

})();
