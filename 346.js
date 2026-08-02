(function () {
    'use strict';

    const PLUGIN_ID = 'pear_smart_addon';
    const CACHE_KEY = 'pear_personal_cache';
    const PREFS_KEY = 'pear_user_prefs_v2';
    const CACHE_TTL = 30 * 60 * 1000;

    // === УТИЛИТЫ ===
    const Utils = {
        log: (...args) => console.log(`[${PLUGIN_ID}]`, ...args),
        error: (...args) => console.error(`[${PLUGIN_ID}]`, ...args),
        
        async safeFetch(url, opts = {}) {
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 8000);
                const res = await fetch(url, { ...opts, signal: ctrl.signal });
                clearTimeout(timer);
                if (!res.ok) throw new Error(res.status);
                return await res.json();
            } catch (e) {
                this.error('Fetch error:', url, e.message);
                return null;
            }
        },

        getCache(key) {
            try {
                const d = Lampa.Storage.get(key);
                return (d && Date.now() - d.t < CACHE_TTL) ? d.v : null;
            } catch(e) { return null; }
        },
        setCache(key, val) {
            try { Lampa.Storage.set(key, { v: val, t: Date.now() }); } catch(e) {}
        }
    };

    // === НАСТРОЙКИ (КАК В LAMPA/SURS) ===
    function registerSettings() {
        // Добавляем вкладку в настройки плагинов
        if (Lampa.SettingsApi) {
            Lampa.SettingsApi.addParam({
                component: 'plugins',
                title: '🍐 Peario Smart Addon',
                items: [
                    { type: 'title', title: 'Персонализация "Интересно Вам"' },
                    { 
                        type: 'input', key: 'pear_genres', 
                        title: 'Любимые жанры (ID TMDB)', 
                        description: 'Через запятую. 28=Боевик, 35=Комедия, 18=Драма, 878=Фантастика',
                        placeholder: '28,35,878'
                    },
                    { 
                        type: 'toggle', key: 'pear_use_history', 
                        title: 'Учитывать историю просмотров', 
                        default: true 
                    },
                    { type: 'title', title: 'Мульти-поиск' },
                    { 
                        type: 'input', key: 'pear_kp_token', 
                        title: 'Kinopoisk API Token', 
                        description: 'Опционально. Для второго источника в поиске.',
                        placeholder: 'Ваш токен kinopoiskapiunofficial.tech'
                    },
                    {
                        type: 'button', title: 'Очистить кэш персонализации',
                        action: () => {
                            Lampa.Storage.remove(CACHE_KEY);
                            Lampa.Notice.show('Кэш очищен!');
                        }
                    }
                ]
            });
        }
    }

    // === ЛОГИКА ДАННЫХ ===
    async function getPersonalizedMovies() {
        const cached = Utils.getCache(CACHE_KEY);
        if (cached) return cached;

        const prefs = Lampa.Storage.get(PREFS_KEY, {});
        let genres = (prefs.pear_genres || '').split(',').map(s => s.trim()).filter(Boolean);
        
        // Fallback: если жанры не заданы, берем популярные
        let url = `https://api.themoviedb.org/3/discover/movie?api_key=4ef0d7f8c3f8e9a2b1d0c3e4f5a6b7c8&language=ru&sort_by=popularity.desc&page=1`;
        if (genres.length > 0) url += `&with_genres=${genres.join('|')}`;

        const data = await Utils.safeFetch(url);
        const movies = (data?.results || []).map(m => ({
            id: m.id,
            title: m.title,
            original_title: m.original_title,
            poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
            overview: m.overview,
            release_date: m.release_date,
            vote_average: m.vote_average,
            source: 'tmdb'
        }));

        Utils.setCache(CACHE_KEY, movies);
        return movies;
    }

    async function multiSearch(query) {
        if (!query || query.length < 2) return [];
        const enc = encodeURIComponent(query);
        const kpToken = Lampa.Storage.get('pear_kp_token', '');
        
        const tasks = [
            Utils.safeFetch(`https://api.themoviedb.org/3/search/multi?api_key=4ef0d7f8c3f8e9a2b1d0c3e4f5a6b7c8&query=${enc}&language=ru`)
        ];

        if (kpToken) {
            tasks.push(Utils.safeFetch(`https://kinopoiskapiunofficial.tech/api/v2.2/films?keyword=${enc}&page=1`, {
                headers: { 'X-API-KEY': kpToken }
            }));
        }

        const results = await Promise.allSettled(tasks);
        let items = [];

        // TMDB
        if (results[0].status === 'fulfilled' && results[0].value?.results) {
            items = items.concat(results[0].value.results
                .filter(i => i.media_type === 'movie' || i.media_type === 'tv')
                .map(i => ({
                    id: i.id, title: i.title || i.name, 
                    poster: i.poster_path ? `https://image.tmdb.org/t/p/w500${i.poster_path}` : '',
                    year: (i.release_date || '').slice(0,4), source: 'TMDB'
                }))
            );
        }

        // KP
        if (results[1]?.status === 'fulfilled' && results[1].value?.films) {
            items = items.concat(results[1].value.films.map(i => ({
                id: i.kinopoiskId, title: i.nameRu || i.nameEn,
                poster: i.posterUrlPreview || '', year: String(i.year || ''), source: 'KP'
            })));
        }

        // Дедупликация
        const seen = new Set();
        return items.filter(m => {
            const k = `${m.title.toLowerCase()}_${m.year}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    // === UI: СОЗДАНИЕ НАТИВНОЙ КАРТОЧКИ LAMPA ===
    function createNativeCard(movieData) {
        // Используем встроенный конструктор карточек Lampa
        // Это гарантирует работу фокуса, анимаций и стилей темы
        const card = new Lampa.Card({
            data: movieData,
            nometa: true,
            object: { title: movieData.title }
        });
        
        card.render().addEventListener('click', () => {
            Lampa.Activity.push({
                component: 'info',
                id: movieData.id,
                source: movieData.source || 'tmdb',
                card: movieData
            });
        });

        return card.render();
    }

    // === ИНЪЕКЦИЯ В ИНТЕРФЕЙС SURS ===
    function injectPearioSection() {
        // Ищем контейнер, который создает SURS или стандартная главная
        // SURS обычно создает блоки с классом .surs-row или внутри .main__body
        const target = document.querySelector('.surs-container') || 
                       document.querySelector('.main__body') || 
                       document.querySelector('.content');

        if (!target || target.querySelector('#pear-section')) return;

        const section = document.createElement('div');
        section.id = 'pear-section';
        section.className = 'surs-row'; // Используем класс SURS для стилизации
        section.style.cssText = 'margin-bottom: 25px; padding: 0 15px;';
        
        const header = document.createElement('div');
        header.className = 'surs-row__title selector'; // Нативный класс заголовка
        header.innerText = '⭐ Интересно лично вам';
        header.style.cssText = 'font-size: 22px; margin-bottom: 15px; cursor: pointer;';
        
        const row = document.createElement('div');
        row.className = 'surs-row__items scrollable'; // Класс для горизонтального скролла
        
        section.appendChild(header);
        section.appendChild(row);
        
        // Вставляем ПОСЛЕ первого блока SURS (или в начало)
        const firstRow = target.querySelector('.surs-row');
        if (firstRow && firstRow.nextSibling) {
            target.insertBefore(section, firstRow.nextSibling);
        } else {
            target.prepend(section);
        }

        // Загрузка контента
        row.innerHTML = '<div style="padding:20px; opacity:0.5;">Загрузка...</div>';
        getPersonalizedMovies().then(movies => {
            row.innerHTML = '';
            if (!movies.length) {
                row.innerHTML = '<div style="padding:20px;">Нет данных. Проверьте настройки плагина.</div>';
                return;
            }
            movies.slice(0, 20).forEach(m => row.appendChild(createNativeCard(m)));
            
            // Инициализация навигации для нового блока
            Lampa.Controller.collectionAdd({
                name: 'pear_row',
                elements: row.querySelectorAll('.card'),
                active: row.querySelector('.card')
            });
        });
    }

    // === ДОБАВЛЕНИЕ ПУНКТА МЕНЮ ПОИСКА ===
    function addSearchMenuItem() {
        // Добавляем кнопку в главное меню рядом с "Поиск"
        Lampa.Listener.follow('menu', (e) => {
            if (e.type === 'build' && e.object && !e.object.querySelector('#pear-search-btn')) {
                const btn = document.createElement('div');
                btn.id = 'pear-search-btn';
                btn.className = 'menu__item selector';
                btn.innerHTML = '<span>🔍 Мульти-поиск</span>';
                
                btn.addEventListener('click', () => {
                    // Открываем модальное окно поиска
                    const modal = new Lampa.Modal({
                        title: 'Мульти-поиск (TMDB + KP)',
                        content: `<div style="padding:20px;">
                            <input type="text" class="pear-search-input" placeholder="Введите название..." 
                                   style="width:100%; padding:12px; font-size:18px; background:#333; border:none; color:#fff; border-radius:8px;">
                            <div class="pear-search-results" style="margin-top:20px; max-height:60vh; overflow-y:auto;"></div>
                        </div>`,
                        width: 800
                    });
                    
                    modal.open();
                    
                    const input = modal.render().querySelector('.pear-search-input');
                    const results = modal.render().querySelector('.pear-search-results');
                    let debounce;
                    
                    input.focus();
                    input.addEventListener('input', (ev) => {
                        clearTimeout(debounce);
                        debounce = setTimeout(async () => {
                            const q = ev.target.value.trim();
                            if (q.length < 2) return;
                            results.innerHTML = 'Поиск...';
                            const found = await multiSearch(q);
                            results.innerHTML = '';
                            found.forEach(m => {
                                const el = document.createElement('div');
                                el.className = 'selector';
                                el.style.cssText = 'display:flex; align-items:center; padding:10px; margin-bottom:8px; background:#2a2a2a; border-radius:8px; cursor:pointer;';
                                el.innerHTML = `
                                    <img src="${m.poster}" style="width:50px; height:75px; object-fit:cover; border-radius:4px; margin-right:15px;">
                                    <div><div style="font-size:16px;">${m.title}</div>
                                    <div style="font-size:12px; opacity:0.6;">${m.year} • ${m.source}</div></div>
                                `;
                                el.onclick = () => {
                                    modal.close();
                                    Lampa.Activity.push({ component: 'info', id: m.id, source: m.source === 'KP' ? 'kp' : 'tmdb', card: m });
                                };
                                results.appendChild(el);
                            });
                        }, 500);
                    });
                });
                
                e.object.appendChild(btn);
            }
        });
    }

    // === ЗАПУСК ===
    function init() {
        Utils.log('Starting v2.0...');
        registerSettings();
        addSearchMenuItem();

        // Ждем полной загрузки SURS и главной страницы
        const checkInterval = setInterval(() => {
            const isHome = Lampa.Activity.active()?.component === 'main';
            const hasSurs = document.querySelector('.surs-container') || document.querySelector('.main__body');
            
            if (isHome && hasSurs) {
                clearInterval(checkInterval);
                injectPearioSection();
                Utils.log('Injection successful');
            }
        }, 500);

        // Таймаут безопасности
        setTimeout(() => clearInterval(checkInterval), 10000);
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', e => { if (e.type === 'ready') init(); });

})();
