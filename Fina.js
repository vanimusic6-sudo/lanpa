(function () {
    'use strict';
    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;

    var PLUGIN_ID = 'should_watch_plugin';
    var ICON = '<svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="8" stroke-linecap="square" fill="none"><path d="M20,55 L40,75 L80,25"/><path d="M25,25 L75,75" stroke-dasharray="4,4"/></g></svg>';
    var DISPLAY = '"Trebuchet MS","Segoe UI",system-ui,sans-serif';

    window._sw_rolling = false;
    window._sw_currentModalHtml = null;
    window._sw_prevController = null;
    window._sw_closingFromController = false;
    window._sw_loaderTimer = null;
    window._sw_focusIdx = 0;
    window._sw_blocknav = true;
    window._sw_scrollContainer = null;
    window._sw_navPoints = [];
    window._sw_currentNavPoint = 0;
    var _metaCache = {};

    /* ===== СПИСОК ИЗВЕСТНЫХ ДЕТСКИХ ФИЛЬМОВ ===== */
    var KNOWN_FAMILY_MOVIES = [
        'дикий робот', 'робот дикий', 'the wild robot',
        'холодное сердце', 'frozen',
        'тачки', 'cars',
        'в поисках немо', 'finding nemo',
        'в поисках дори', 'finding dory',
        'суперсемейка', 'the incredibles',
        'рататуй', 'ratatouille',
        'вверх', 'up',
        'wall-e', 'валли',
        'король лев', 'the lion king',
        'красавица и чудовище', 'beauty and the beast',
        'аладдин', 'aladdin',
        'мулан', 'mulan',
        'покахонтас', 'pocahontas',
        'геркулес', 'hercules',
        'тараканы', 'a bug\'s life', 'приключения флика',
        'монстры на каникулах', 'monsters inc', 'корпорация монстров',
        'университет монстров', 'monsters university',
        'головоломка', 'inside out',
        'хороший динозавр', 'the good dinosaur',
        'лава', 'lava',
        'пиксар', 'pixar',
        'дизней', 'disney',
        'сонная лощина', 'sleeping beauty', 'спящая красавица',
        'золушка', 'cinderella',
        'белоснежка', 'snow white',
        'русалочка', 'the little mermaid',
        'питер пэн', 'peter pan',
        'буратино',
        'чебурашка',
        'ну погоди',
        'маша и медведь',
        'смешарики',
        'фиксики',
        'лунтик',
        'барбоскины',
        'три кота',
        'toy story', 'история игрушек',
        'моана', 'moana',
        'зоотопия', 'zootopia',
        'коко', 'тайна коко', 'coco',
        'душа', 'soul',
        'лука', 'luca',
        'вперёд', 'onward',
        'энканто', 'encanto',
        'я краснею', 'turning red',
        'базз лайтер', 'lightyear',
        'элементарно', 'elemental',
        'человек-паук: через вселенные', 'spider-verse',
        'семейка митчеллов против машин', 'mitchells vs the machines',
        'шрек', 'shrek',
        'гадкий я', 'despicable me',
        'миньоны', 'minions',
        'пой', 'sing',
        'тайная жизнь домашних животных', 'the secret life of pets',
        'как приручить дракона', 'how to train your dragon',
        'кунг-фу панда', 'kung fu panda',
        'мадагаскар', 'madagascar',
        'тролли', 'trolls',
        'семейка крудс', 'the croods'
    ];

    /* ===== НАСТРОЙКИ ===== */
    function getSetting(k, d) { try { var v = Lampa.Storage.get(PLUGIN_ID + '_' + k); if (v !== undefined && v !== null && v !== '') return v; } catch(e) {} return d; }
    function saveSetting(k, v) { try { Lampa.Storage.set(PLUGIN_ID + '_' + k, v); } catch(e) {} }
    function getSettings() {
        return {
            bad_genres: String(getSetting('bad_genres', '') || ''),
            bad_actors: String(getSetting('bad_actors', '') || ''),
            bad_directors: String(getSetting('bad_directors', '') || ''),
            min_rating: parseFloat(getSetting('min_rating', '6')) || 6
        };
    }
    function parseBL(s) { return s ? s.split(',').map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean) : []; }
    function initSettings() {
        try {
            if (!window.Lampa || !Lampa.SettingsApi || window.sw_settings_ready) return;
            window.sw_settings_ready = true;
            Lampa.SettingsApi.addComponent({ component: PLUGIN_ID, name: 'Стоит ли смотреть?', icon: ICON });
            [
                { name: 'bad_genres', type: 'input', title: 'Нелюбимые жанры', description: 'Через запятую', default: '' },
                { name: 'bad_actors', type: 'input', title: 'Нелюбимые актёры', description: 'Через запятую', default: '' },
                { name: 'bad_directors', type: 'input', title: 'Нелюбимые авторы', description: 'Через запятую', default: '' },
                { name: 'min_rating', type: 'select', title: 'Мин. рейтинг', values: {'0':'Любой','5':'5.0','6':'6.0','7':'7.0','8':'8.0'}, default: '6' }
            ].forEach(function(p) {
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: PLUGIN_ID + '_' + p.name, type: p.type, values: p.values || '', default: p.default },
                    field: { name: p.title, description: p.description }
                });
            });
        } catch(e) { console.error('[SW] initSettings:', e); }
    }

    /* ===== СТИЛИ ===== */
    function injectCSS() {
        try {
            if (document.getElementById('sw-plugin-styles')) return;
            var s = document.createElement('style'); s.id = 'sw-plugin-styles';
            s.innerHTML =
                '.sw-modal-content{padding:20px 22px 40px;color:#fff;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;min-height:80vh;max-height:90vh;overflow-y:auto;-webkit-overflow-scrolling:touch;scroll-behavior:smooth}' +
                '.sw-modal-content::-webkit-scrollbar{width:6px}.sw-modal-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:3px}.sw-modal-content::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.35)}' +
                '.sw-body{animation:swFade .35s ease}' +
                '.sw-focusable{outline:none;cursor:pointer}' +
                '.sw-focusable.focus{box-shadow:0 0 0 3px rgba(255,255,255,.92),0 0 24px rgba(255,255,255,.22);transition:box-shadow .15s ease;scroll-margin-top:20px;scroll-margin-bottom:20px}' +
                '.sw-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:64px 20px;color:#cbd5e1}' +
                '.sw-loader-dice{font-size:3.2em;line-height:1;animation:swBounce 1s ease-in-out infinite;filter:drop-shadow(0 4px 12px rgba(133,194,94,.35))}' +
                '.sw-loader-text{font-size:1.1em;font-weight:600;min-height:1.4em;transition:opacity .25s;color:#94a3b8}' +
                '.sw-loader-bar{width:200px;height:3px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}' +
                '.sw-loader-bar::after{content:"";position:absolute;left:-40%;top:0;height:100%;width:40%;background:linear-gradient(90deg,transparent,#85c25e,transparent);animation:swSlide 1.1s linear infinite}' +
                '.sw-dossier{position:relative;padding:20px 22px;border-radius:16px;margin-bottom:22px;overflow:hidden;background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.015));border:1px solid rgba(255,255,255,.08);animation:swRise .5s cubic-bezier(.22,1,.36,1) both}' +
                '.sw-dossier::before{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 100% 0%,rgba(133,194,94,.10),transparent 60%);pointer-events:none}' +
                '.sw-verdict-word{font-family:' + DISPLAY + ';font-size:2.7em;font-weight:900;letter-spacing:-.02em;line-height:1;margin:0 0 6px;text-transform:uppercase}' +
                '.sw-verdict-word.yes{color:#85c25e}.sw-verdict-word.no{color:#d9534f}.sw-verdict-word.maybe{color:#e0a93b}' +
                '.sw-verdict-reason{font-size:1em;color:#c4ccd6;line-height:1.45;margin:0 0 16px;max-width:62ch}' +
                '.sw-meter{height:10px;border-radius:6px;background:rgba(0,0,0,.35);overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.4)}' +
                '.sw-meter-fill{height:100%;width:0;border-radius:6px;transition:width 1s cubic-bezier(.22,1,.36,1)}' +
                '.sw-meter-fill.yes{background:#85c25e}.sw-meter-fill.no{background:#d9534f}.sw-meter-fill.maybe{background:#e0a93b}' +
                '.sw-mode-badge{position:absolute;top:16px;right:18px;display:inline-flex;align-items:center;gap:6px;font-size:.7em;padding:4px 11px;border-radius:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}' +
                '.sw-mode-badge.tmdb{background:#0d8050;color:#fff}.sw-mode-badge.tags{background:rgba(255,255,255,.15);color:#ccc}' +
                '.sw-mode-dot{width:7px;height:7px;border-radius:50%;display:inline-block}' +
                '.sw-mode-dot.active{background:#85c25e;animation:swPulse 1.4s ease-in-out infinite}.sw-mode-dot.inactive{background:#9aa0a6}' +
                '.sw-columns{display:flex;justify-content:space-between;gap:18px;margin-bottom:20px;flex-wrap:wrap}' +
                '.sw-col{flex:1;min-width:280px;background:rgba(255,255,255,.04);padding:15px 17px;border-radius:12px;border:1px solid rgba(255,255,255,.06);transition:transform .2s ease,border-color .2s ease,background .2s ease,box-shadow .15s ease}' +
                '.sw-title{font-family:' + DISPLAY + ';font-size:1.02em;font-weight:800;margin-bottom:13px;text-transform:uppercase;display:flex;align-items:center;gap:8px;letter-spacing:.03em}' +
                '.sw-title.pros{color:#85c25e}.sw-title.cons{color:#d9534f}.sw-title.target{color:#e0e0e0}' +
                '.sw-list{margin:0;padding-left:18px;font-size:.96em;line-height:1.5;color:#cdd3db}.sw-list li{margin-bottom:9px;animation:swFade .4s ease both}' +
                '.sw-quote{position:relative;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:18px 20px 16px 50px;margin-bottom:20px}' +
                '.sw-quote::before{content:"\\"";position:absolute;left:13px;top:0;font-size:3.3em;line-height:1;color:rgba(255,255,255,.18);font-family:Georgia,serif;font-weight:700}' +
                '.sw-quote-text{font-size:1.03em;line-height:1.55;color:#dfe5ec;font-style:italic}' +
                '.sw-quote-meta{margin-top:9px;font-size:.82em;color:#8b929c}' +
                '.sw-quote-tone{display:inline-block;padding:2px 9px;border-radius:8px;font-style:normal;font-weight:700;margin-left:8px;text-transform:uppercase;font-size:.78em;letter-spacing:.05em}' +
                '.sw-quote-tone.pos{background:rgba(133,194,94,.18);color:#9bd07a}.sw-quote-tone.neg{background:rgba(217,83,79,.18);color:#e88}.sw-quote-tone.mix{background:rgba(224,169,59,.18);color:#e7c06a}' +
                '.sw-target-audience{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);padding:16px 18px;border-radius:12px;line-height:1.6;color:#d6dce4;font-size:1.02em;margin-bottom:20px}' +
                '.sw-aud-text{font-size:1.05em;line-height:1.55;color:#d6dce4}' +
                '.sw-decision{text-align:center;padding:18px 18px;background:rgba(255,255,255,.03);border-radius:14px;border:1px solid rgba(255,255,255,.06)}' +
                '.sw-decision-hint{font-size:.85em;color:#8b929c;margin-bottom:12px}' +
                '.sw-dice-btn{background:#eadecd;color:#1a1a1a;font-family:' + DISPLAY + ';font-size:1.2em;font-weight:800;padding:13px 32px;border-radius:30px;display:inline-flex;align-items:center;gap:12px;transition:transform .2s,background .2s,box-shadow .2s;cursor:pointer;outline:none;border:3px solid transparent}' +
                '.sw-dice-btn.focus{background:#fff;transform:scale(1.05);box-shadow:0 0 0 3px #fff,0 0 20px rgba(255,255,255,.4);border-color:#fff}' +
                '.sw-dice-btn.shake{animation:swShake .5s}' +
                '.sw-verdict-roll{margin-top:12px;font-family:' + DISPLAY + ';font-size:1.45em;font-weight:900;min-height:34px;text-transform:uppercase;letter-spacing:.01em;transition:color .2s}' +
                '.sw-verdict-roll.verdict-yes{color:#85c25e!important;text-shadow:0 0 12px rgba(133,194,94,.35)}' +
                '.sw-verdict-roll.verdict-no{color:#d9534f!important;text-shadow:0 0 12px rgba(217,83,79,.35)}' +
                '@keyframes swShake{0%,100%{transform:translate(1px,-2px) rotate(-1deg)}10%,30%,50%,70%,90%{transform:translate(-1px,2px) rotate(1deg)}20%,40%,60%,80%{transform:translate(-3px,0) rotate(0deg)}}' +
                '@keyframes swFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}' +
                '@keyframes swRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}' +
                '@keyframes swBounce{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-14px) rotate(6deg)}}' +
                '@keyframes swSlide{0%{left:-40%}100%{left:100%}}' +
                '@keyframes swPulse{0%,100%{box-shadow:0 0 0 0 rgba(133,194,94,.6)}50%{box-shadow:0 0 0 5px rgba(133,194,94,0)}}' +
                '@media(max-width:640px){.sw-columns{flex-direction:column}.sw-verdict-word{font-size:2.2em}.sw-col{min-width:auto}}' +
                '/* Navigation points for TV */ .sw-nav-point{scroll-margin-top:40px;scroll-margin-bottom:40px} .sw-focusable.nav-point{box-shadow:0 0 0 4px rgba(255,255,255,.7)!important}';
            document.head.appendChild(s);
        } catch(e) { console.error('[SW] injectCSS:', e); }
    }

    /* ===== УТИЛИТЫ ===== */
    var escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function esc(s) {
        if (typeof s !== 'string') return '';
        return s.replace(/[&<>"']/g, function(m) { return escMap[m]; });
    }
    function hasGenre(g, re) { return g.some(function(x){ return re.test(x.toLowerCase()); }); }
    function inText(s, re) { return re.test((s || '').toLowerCase()); }
    function inAnyText(texts, re) { return texts.some(function(s){ return inText(s, re); }); }
    function mediaType(m) { return (m && m.name && !m.title) ? 'tv' : 'movie'; }

    /* ===== ПРОВЕРКА ИЗВЕСТНЫХ ДЕТСКИХ ФИЛЬМОВ ===== */
    function isKnownFamilyMovie(title, originalTitle) {
        if (!title && !originalTitle) return false;
        var checkTitle = ' ' + (title || '').toLowerCase() + ' ';
        var checkOriginal = ' ' + (originalTitle || '').toLowerCase() + ' ';
        return KNOWN_FAMILY_MOVIES.some(function(movie) {
            var m = movie.toLowerCase();
            // Регулярное выражение для проверки границ слов, чтобы "up" не находилось в "superman"
            var regexStr = '(^|[^a-zа-яё0-9])' + m.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '([^a-zа-яё0-9]|$)';
            var re = new RegExp(regexStr, 'i');
            return re.test(checkTitle) || re.test(checkOriginal);
        });
    }

    /* ===== УЛУЧШЕННАЯ НАВИГАЦИЯ ДЛЯ TV ===== */
    function initNavPoints(html) {
        try {
            if (!html || !html.length) return;
            var container = html.find('.sw-modal-content');
            if (!container.length) return;
            
            window._sw_navPoints = [];
            
            var topPoint = html.find('.sw-dossier');
            if (topPoint.length) {
                topPoint.addClass('sw-nav-point');
                window._sw_navPoints.push(topPoint);
            }
            
            var middlePoint = html.find('.sw-columns');
            if (middlePoint.length) {
                middlePoint.addClass('sw-nav-point');
                window._sw_navPoints.push(middlePoint);
            }
            
            var bottomPoint = html.find('.sw-dice-btn').parent();
            if (bottomPoint.length) {
                bottomPoint.addClass('sw-nav-point');
                window._sw_navPoints.push(bottomPoint);
            }
            
            if (window._sw_navPoints.length === 0) {
                window._sw_navPoints = html.find('.sw-focusable');
            }
            
            window._sw_currentNavPoint = 0;
        } catch(e) { console.error('[SW] initNavPoints:', e); }
    }

    function scrollToNavPoint(index) {
        try {
            if (!window._sw_navPoints || window._sw_navPoints.length === 0) return;
            if (index < 0) index = 0;
            if (index >= window._sw_navPoints.length) index = window._sw_navPoints.length - 1;
            
            var point = window._sw_navPoints[index];
            
            if (point && point.length) {
                // Нативный скролл работает на порядок стабильнее и плавнее на WebOS/Tizen, чем jQuery animate
                try {
                    point[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch(e) {
                    var container = window._sw_scrollContainer;
                    if (container && container.length) {
                        container[0].scrollTop = point[0].offsetTop - 20;
                    }
                }
                
                setTimeout(function() {
                    try {
                        point.addClass('focus');
                        var focusTarget = point.find('.sw-focusable').first();
                        if (!focusTarget.length) focusTarget = point;
                        
                        try { focusTarget[0].focus({ preventScroll: true }); } catch(_) {}
                        Lampa.Controller.collectionFocus(focusTarget);
                    } catch(e) {}
                }, 300); // Ждем окончания скролла
                
                window._sw_currentNavPoint = index;
            }
        } catch(e) { console.error('[SW] scrollToNavPoint:', e); }
    }

    function scrollToElement(el, container) {
        try {
            if (!el || !el.length) return;
            el[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch(e) { console.error('[SW] scrollToElement:', e); }
    }

    function swSetFocus(i) {
        try {
            var h = window._sw_currentModalHtml;
            if (!h) return;
            var blocks = h.find('.sw-focusable');
            if (!blocks.length) return;
            
            if (i < 0) i = 0;
            if (i >= blocks.length) i = blocks.length - 1;
            window._sw_focusIdx = i;
            
            blocks.removeClass('focus');
            var el = blocks.eq(i);
            el.addClass('focus');
            
            try { el[0].focus({ preventScroll: true }); } catch(e) { try { el[0].focus(); } catch(_) {} }
            
            var container = h.find('.sw-modal-content');
            if (container.length) {
                window._sw_scrollContainer = container;
                scrollToElement(el, container);
            } else {
                try { el[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch(e) {}
            }
            
            try { Lampa.Controller.collectionFocus(el); } catch(e) {}
        } catch(e) { console.error('[SW] setFocus:', e); }
    }

    /* ===== ДОГРУЗКА ===== */
    function loadCredits(movie) {
        try {
            if (movie.credits && ((movie.credits.cast && movie.credits.cast.length) || (movie.credits.crew && movie.credits.crew.length))) return Promise.resolve(movie.credits);
            var id = movie.id || movie.tmdb_id; if (!id) return Promise.resolve(null);
            if (Lampa.TMDB && typeof Lampa.TMDB.credits === 'function') {
                return new Promise(function(res) { Lampa.TMDB.credits(id, function(d){ res(d && !d.status_code ? d : null); }, function(){ res(null); }); });
            }
        } catch(e) { console.error('[SW] loadCredits:', e); }
        return Promise.resolve(null);
    }
    function tmdbKey() { try { if (Lampa.TMDB && Lampa.TMDB.key) return Lampa.TMDB.key; } catch(e) {} return '4ef0d7355d9ffb5151e987764708ce96'; }
    
    function tmdbGet(path) {
        return new Promise(function(res) {
            try {
                // Добавляем язык пользователя для получения релевантных отзывов и ключевых слов
                var lang = Lampa.Storage.get('language', 'ru');
                var langCode = lang + '-' + lang.toUpperCase();
                var url = 'https://api.themoviedb.org/3' + path + (path.indexOf('?') > -1 ? '&' : '?') + 'language=' + langCode + '&api_key=' + tmdbKey();
                
                if (Lampa.Request) {
                    Lampa.Request.get(url, function(data) {
                        res(data && data.status_code ? null : data);
                    }, function() { res(null); });
                } else if (typeof fetch !== 'undefined') {
                    fetch(url)
                        .then(function(r){ return r.json(); })
                        .then(function(d){ res(d && d.status_code ? null : d); })
                        .catch(function(){ res(null); });
                } else {
                    res(null);
                }
            } catch(e) { res(null); }
        });
    }
    function mapUSRating(s) { 
        return { 
            'G':0, 'PG':7, 'PG-13':13, 'R':17, 'NC-17':17, 
            'TV-MA':17, 'TV-14':14, 'TV-PG':7, 'TV-G':0, 'TV-Y7':7, 'TV-Y':0,
            'MA':17, '18':18, '16':16, '12':12, '12A':12, '15':15, '7':7, '6':6, 'U':0, '0':0
        }[(s || '').toUpperCase().trim()] || null; 
    }
    function loadMeta(movie) {
        var id = movie.id || movie.tmdb_id; if (!id) return Promise.resolve({ kw: [], age: null, reviews: [], hasTrailer: false, enOv: '' });
        if (_metaCache[id]) return Promise.resolve(_metaCache[id]);
        
        // Ограничение размера кэша
        if (Object.keys(_metaCache).length > 100) _metaCache = {};
        
        var type = mediaType(movie);
        return Promise.all([
            tmdbGet('/' + type + '/' + id + '/keywords'),
            tmdbGet('/' + type + '/' + id + '/content_ratings'),
            tmdbGet('/' + type + '/' + id + '/reviews'),
            tmdbGet('/' + type + '/' + id + '/videos'),
            tmdbGet('/' + type + '/' + id)
        ]).then(function(arr) {
            var kw = [];
            if (arr[0]) (arr[0].keywords || arr[0].results || []).forEach(function(k){ if (k && k.name) kw.push(k.name.toLowerCase()); });
            
            var age = null;
            if (arr[1] && arr[1].results) {
                var ru = arr[1].results.find(function(x){ return x.iso_3166_1 === 'RU'; });
                var us = arr[1].results.find(function(x){ return x.iso_3166_1 === 'US'; });
                var de = arr[1].results.find(function(x){ return x.iso_3166_1 === 'DE'; });
                var gb = arr[1].results.find(function(x){ return x.iso_3166_1 === 'GB'; });
                
                if (ru && ru.rating) { var n = parseInt(ru.rating); if (!isNaN(n)) age = n; }
                if (age === null && us && us.rating) age = mapUSRating(us.rating);
                if (age === null && de && de.rating) { var n = parseInt(de.rating.replace('FSK ', '')); if (!isNaN(n)) age = n; }
                if (age === null && gb && gb.rating) age = mapUSRating(gb.rating);
                
                if (age === null && arr[1].results.length > 0) {
                    var first = arr[1].results[0];
                    if (first.rating) {
                        var n = parseInt(first.rating);
                        if (!isNaN(n)) age = n;
                        else age = mapUSRating(first.rating);
                    }
                }
            }
            
            var reviews = [];
            if (arr[2] && arr[2].results) 
                reviews = arr[2].results.slice(0, 5).map(function(r){ 
                    return { author: r.author || 'Аноним', text: (r.content || '').replace(/<[^>]+>/g, '').trim() }; 
                }).filter(function(r){ return r.text.length > 20; });
            
            var hasTrailer = false;
            if (arr[3] && arr[3].results) hasTrailer = arr[3].results.some(function(v){ return v.type === 'Trailer' && v.site === 'YouTube'; });
            
            var enOv = (arr[4] && arr[4].overview) ? arr[4].overview : '';
            var r = { kw: kw, age: age, reviews: reviews, hasTrailer: hasTrailer, enOv: enOv }; 
            _metaCache[id] = r; 
            return r;
        });
    }
    function hasKw(ctx, re) { return ctx.kw.some(function(k){ return re.test(k); }); }

    function reviewTone(reviews) {
        if (!reviews.length) return { tone: null, sample: null };
        var posRe = /шедевр|великолепн|потрясающ|восхитит|блестящ|лучш|мощн|гениальн|masterpiece|brilliant|amazing|great|best|loved|perfect|outstanding|precisely|flawless|must-watch|замечательн|превосходн|отличн/i;
        var negRe = /скучн|ужасн|провал|разочаров|слаб|затян|бессмысл|плох|boring|bad|worst|terrible|awful|disappoint|waste|dull|pointless|ridiculous|утомительн|неинтересн/i;
        var pos = 0, neg = 0, firstNeg = null, firstPos = null;
        reviews.forEach(function(r) {
            var t = r.text.toLowerCase();
            var p = (t.match(posRe) || []).length, n = (t.match(negRe) || []).length;
            if (p > n) { pos++; if (!firstPos) firstPos = r; }
            else if (n > p) { neg++; if (!firstNeg) firstNeg = r; }
        });
        var tone = (pos === 0 && neg === 0) ? null : (pos > neg + 1 ? 'pos' : (neg > pos + 1 ? 'neg' : 'mix'));
        var sample = (tone === 'neg' ? firstNeg : (tone === 'pos' ? firstPos : (firstNeg || firstPos))) || reviews[0];
        return { tone: tone, sample: sample };
    }

    /* ===== УЛУЧШЕННАЯ ЛОГИКА ОПРЕДЕЛЕНИЯ АУДИТОРИИ ===== */
    function buildAudience(pros, cons, genres, rating, familyOK, age, isAnim, ctx, movieTitle, movieOriginalTitle) {
        var hasCult = pros.some(function(p){ return /культ|классик|легендарн/i.test(p.toLowerCase()); });
        var hasHype = pros.some(function(p){ return /хайп|популярн|обсуждаем|тренд/i.test(p.toLowerCase()); });
        var hasGem = pros.some(function(p){ return /жемчужин|скрыт|недооцен|шедевр/i.test(p.toLowerCase()); });
        var hasAction = hasGenre(genres, /action|боевик|экшен|приключен/i) || pros.some(function(p){ return /драйв|экшен|динамичн/i.test(p.toLowerCase()); });
        var hasMusic = pros.some(function(p){ return /музык|саундтрек|композитор|мелоди/i.test(p.toLowerCase()); });
        var hasDoc = hasGenre(genres, /documentary|документ/i) || pros.some(function(p){ return /познавательн|обучающ|интересн/i.test(p.toLowerCase()); });
        var hasComedy = hasGenre(genres, /comedy|комеди/i);
        var hasDrama = hasGenre(genres, /drama|драма/i);
        var hasSciFi = hasGenre(genres, /sci-fi|fantasy|фантастик|фэнтези|cosmic|космич/i);
        var hasThriller = hasGenre(genres, /thriller|horror|триллер|ужас|мистик/i);
        var hasCrime = hasGenre(genres, /crime|криминал|детектив/i);
        var hasAdventure = hasGenre(genres, /adventure|приключен/i);
        var hasRomance = hasGenre(genres, /romance|мелодрама|любовн|романтич/i);

        var hasViolence = cons.some(function(c){ return /жесток|насили|кров|убийств|бойн/i.test(c.toLowerCase()); }) || hasKw(ctx, /violenc|gore|murder|blood|brutal/);
        var hasDrugs = cons.some(function(c){ return /нарко|метамфетамин|кокаин|героин/i.test(c.toLowerCase()); }) || hasKw(ctx, /drug|narcotic|meth|cocaine|heroin/);
        var hasNudity = cons.some(function(c){ return /нагот|обнаж/i.test(c.toLowerCase()); }) || hasKw(ctx, /nudity|female nudity|male nudity/);
        var hasStrongLang = cons.some(function(c){ return /мат|нецензур/i.test(c.toLowerCase()); }) || hasKw(ctx, /profanity|strong language/);

        var parts = [];
        
        if (hasCult && rating >= 8) parts.push('ценит классику и проверенные временем фильмы');
        else if (hasHype) parts.push('хочет быть в курсе актуального');
        else if (hasGem) parts.push('любит открывать недооценённые фильмы');
        else if (hasAction) parts.push('ищет динамичный сюжет');
        else if (hasThriller) parts.push('любит напряжённые истории');
        else if (hasComedy) parts.push('ищет повод для смеха');
        else if (hasDrama && rating >= 7) parts.push('ценит глубокие и эмоциональные истории');
        else if (hasSciFi) parts.push('любит фантастические миры');
        else if (hasDoc) parts.push('интересуется познавательным контентом');
        else if (hasMusic) parts.push('ценит качественную музыку');
        else if (hasAdventure) parts.push('жаждет увлекательных приключений');
        else if (hasRomance) parts.push('любит романтические истории');
        else if (hasCrime) parts.push('увлекается детективами и расследованиями');
        
        if (parts.length === 0) {
            if (rating >= 8) parts.push('ценит качественное кино');
            else if (rating >= 6) parts.push('ищет интересный фильм для просмотра');
            else parts.push('готов экспериментировать');
        }

        if (familyOK) return 'Семьям для совместного просмотра';
        
        var base = 'Тем, кто ' + parts[0];
        
        var warnings = [];
        if (hasViolence) warnings.push('жёстким сценам');
        if (hasDrugs) warnings.push('темам наркотиков');
        if (hasNudity) warnings.push('откровенным сценам');
        if (hasStrongLang) warnings.push('нецензурной лексике');
        if (age !== null && age >= 18) warnings.push('взрослому контенту (' + age + '+)');
        else if (age !== null && age >= 16) warnings.push('контенту для старших (' + age + '+)');
        
        if (warnings.length > 0) {
            base += ' и не против ' + warnings.join(', ');
        }
        
        if (isAnim && !familyOK && age !== null && age >= 16) {
            // ИСПРАВЛЕН БАГ С ПРИОРИТЕТОМ ОПЕРАТОРОВ
            base = 'Фанатам анимации, которые не против ' + (warnings.length > 0 ? warnings.join(', ') : 'взрослого контента');
        }
        
        if (isKnownFamilyMovie(movieTitle, movieOriginalTitle) && !familyOK) {
            base = 'Семьям для совместного просмотра';
        }
        
        return base;
    }

    /* ===== АНАЛИЗ ===== */
    function analyze(movie) {
        return Promise.all([ loadCredits(movie), loadMeta(movie) ]).then(function(arr) {
            var credits = arr[0], meta = arr[1];
            var cfg = getSettings();
            var blG = parseBL(cfg.bad_genres), blA = parseBL(cfg.bad_actors), blD = parseBL(cfg.bad_directors);
            var now = new Date().getFullYear();

            var q = (movie.quality || movie.source_quality || '').toString().toUpperCase();
            var rating = parseFloat(movie.vote_average) || 0;
            var votes = parseInt(movie.vote_count) || 0;
            var runtime = parseInt(movie.runtime) || 0;
            var genres = (movie.genres || []).map(function(g){ return typeof g === 'string' ? g : g.name; }).filter(Boolean);
            var ovRu = (movie.overview || '').trim();
            var ovEn = (meta.enOv || '').trim();
            var ovBoth = [ovRu, ovEn];
            var age = meta.age;
            var yr = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : 0;
            var rt = reviewTone(meta.reviews);
            var dataRich = !!(meta.kw.length || age !== null || meta.reviews.length || (credits && credits.crew && credits.crew.length));

            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){ return c.name; }).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){ return c.job === 'Director'; }).map(function(c){ return c.name; }).filter(Boolean);
            var wrts = crew.filter(function(c){ return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0; }).map(function(c){ return c.name; }).filter(Boolean);
            var ctx = { kw: meta.kw };

            var isAnim = hasGenre(genres, /animation|мульт|анимац|animate/i);
            var kidsKw = hasKw(ctx, /for kids|children|kids|family-friendly|kids tv|детям|семейн|для детей|child|family/i);
            
            var movieTitle = movie.title || '';
            var movieOriginalTitle = movie.original_title || movie.original_name || '';
            var isKnownFamily = isKnownFamilyMovie(movieTitle, movieOriginalTitle);

            var fDrugs    = inAnyText(ovBoth, /метамфетамин|варк|нарко|кокаин|героин|марихуан|каннабис|опиум|амфетамин/i) ||
                            inAnyText(ovBoth, /meth|cocaine|coke|heroin|marijuan|cannabis|substance|quaalude|lsd|ecstasy|opium|overdose|dealer|cartel|crack|drug use|drug deal|drug addict/i) ||
                            hasKw(ctx, /drug|narcotic|addiction|meth|cocaine|coke|heroin|marijuan|substance|quaalude|lsd|ecstasy|opium|overdose|dealer|cartel|crack/);
            var fNudity   = inAnyText(ovBoth, /обнаж|нагот|голы|эротик/i) ||
                            inAnyText(ovBoth, /nude|nudity|strip club|stripper|topless|bare chest|full frontal|rear nudity|sexual content/i) ||
                            hasKw(ctx, /nudity|female nudity|male nudity|full frontal|rear nudity|topless|bare chest|breast|strip club|stripper/);
            var fSex      = inAnyText(ovBoth, /sex|эротик|откровен|оргазм|проститутк|интимн/i) ||
                            inAnyText(ovBoth, /orgy|threesome|one night stand|hooker|prostitut|seduction|affair|infidelity|erotic|explicit sex|orgasm|sex scene|sexual/i) ||
                            hasKw(ctx, /sex scene|sexual content|sexuality|orgy|prostitut|stripper|seduction|affair|infidelity|erotic|one night|threesome|hooker|explicit/) ||
                            !!movie.adult;
            var fViol     = inAnyText(ovBoth, /violenc|gore|murder|убийств|кров|жесток|насил|оружи|стрельб|резн|бойн|террор/i) ||
                            inAnyText(ovBoth, /tortur|brutal|weapon|gun|fight|massacre|execution|stab|slaughter|bloodshed|terror/i) ||
                            hasKw(ctx, /violenc|gore|murder|blood|tortur|brutal|weapon|gun|fight|massacre|execution|stab|slaughter/) ||
                            hasGenre(genres, /horror|ужас|slasher/i) ||
                            (hasGenre(genres, /crime|криминал/i) && hasGenre(genres, /thriller|триллер|action|боевик/i));
            var fSmoke    = inAnyText(ovBoth, /smok|курени|сигарет|табак/i) ||
                            inAnyText(ovBoth, /cigarette|smoking|cigar|vape|tobacco/i) ||
                            hasKw(ctx, /smok|cigarette|cigar/);
            var fAlcohol  = inAnyText(ovBoth, /alcohol|пьян|выпив|алкогол|водк|виски|пьяниц/i) ||
                            inAnyText(ovBoth, /drunkenness|drunk|booze|hangover|alcoholic|vodka|whiskey|binge|beer|wine/i) ||
                            hasKw(ctx, /alcohol|drunkenness|drunk|booze|hangover|alcoholic/);
            var fProfanity= inAnyText(ovBoth, /мат|нецензур|ругательств|брани|обсцен/i) ||
                            inAnyText(ovBoth, /profanity|f word|strong language|vulgarity|cursing|bad language|swearing|cuss|fuck|shit/i) ||
                            hasKw(ctx, /profanity|f word|strong language|vulgarity|cursing|bad language|swearing|cuss/);
            var fHate     = inAnyText(ovBoth, /hate|racis|нацист|расизм|ненавист|ксенофоб/i) || hasKw(ctx, /racis|nazi|homophob|white supremacist|xenophob/);
            var fGamb     = inAnyText(ovBoth, /casino|gambl|казино|ставк|bet|рулетк|покер|азарт/i) || hasKw(ctx, /casino|gambl|betting|poker|gambling/);
            var fSuicide  = inAnyText(ovBoth, /суицид|самоубийств|покончи/i) || inAnyText(ovBoth, /suicide|kill myself/i) || hasKw(ctx, /suicide|self harm/);
            
            var fAdultAnim= isAnim && (hasKw(ctx, /adult animation|dark comed|black comed|dysfunctional|mature|satire|for adults/i) ||
                                       hasGenre(genres, /adult|18+/i) ||
                                       fDrugs || fNudity || fSex || fViol || fProfanity);
            
            var anyAdult = fDrugs || fNudity || fSex || fViol || fSmoke || fAlcohol || fProfanity || fHate || fGamb || fAdultAnim || fSuicide || !!movie.adult;
            
            var familyOK;
            if (isAnim) {
                if (age !== null && age <= 12) familyOK = true;
                else if (age !== null && age > 12) familyOK = false;
                else if (isKnownFamily) familyOK = true;
                else if (kidsKw) familyOK = true;
                else familyOK = false;
            } else {
                familyOK = !anyAdult && rating >= 5 && ((age !== null && age <= 12) || kidsKw || isKnownFamily);
            }
            
            if (isKnownFamily && !familyOK && age === null) {
                familyOK = true;
            }

            var mG = genres.filter(function(g){ return blG.some(function(b){ return g.toLowerCase().indexOf(b) >= 0; }); });
            var mA = cast.filter(function(a){ return blA.some(function(b){ return a.toLowerCase().indexOf(b) >= 0; }); });
            var mD = [].concat(dirs, wrts).filter(function(p){ return blD.some(function(b){ return p.toLowerCase().indexOf(b) >= 0; }); });

            var P = [], C = [];
            function addP(t, w) { P.push({ t: t, w: w }); }
            function addC(t, w) { C.push({ t: t, w: w }); }

            if (rating >= 8.5 && votes >= 5000) addP('⭐ признание зрителей и критиков по всему миру', 35);
            else if (rating >= 8.0 && votes >= 3000) addP('⭐ высокие оценки зрителей и критиков', 30);
            else if (rating >= cfg.min_rating && votes >= 500) addP('⭐ стабильно хорошие оценки', 20);
            else if (rating >= cfg.min_rating && votes >= 100) addP('⭐ оценки выше вашего порога', 18);
            
            if (rating >= 7.8 && votes >= 100 && votes < 1500) addP('🔎 скрытая жемчужина с высоким рейтингом', 18);
            if (rating >= 8.0 && votes >= 2000 && yr > 0 && yr <= now - 3) addP('🏛 культовый фильм', 20);
            if (yr >= now - 1 && votes >= 200) addP('🔥 актуальный фильм — все обсуждают', 12);
            if (yr === now) addP('🆕 свежая новинка', 8);
            if (votes > 0 && votes < 30) addC('❓ мало оценок — вердикт осторожный', 12);
            if (votes === 0) addC('⚠️ нет оценок — данных недостаточно', 15);

            if (rt.tone === 'pos') addP('💬 зрители в восторге', 22);
            else if (rt.tone === 'neg') addC('💬 отрицательные отзывы зрителей', 25);
            else if (rt.tone === 'mix') { 
                addP('💬 фильму дают полярные отзывы', 8); 
                addC('💬 часть зрителей осталась разочарована', 10); 
            }

            if (q && !/CAM|TS|HDCAM|SCR|WORKPRINT|TELESYNC|HDRIP|TELECINE/i.test(q)) addP('🎥 хорошее качество изображения (' + (q || 'HD') + ')', 10);
            if (q && /4K|UHD|2160p/i.test(q)) addP('🎥 отличное 4K-качество', 12);
            if (runtime > 0 && runtime <= 90) addP('🕐 удобная длительность для просмотра (' + runtime + ' мин)', 8);
            if (runtime > 90 && runtime <= 120) addP('🕐 оптимальная длительность (' + runtime + ' мин)', 6);
            
            if (familyOK) addP('👨‍👩‍👧‍👦 подходит для семейного просмотра', 16);
            if (hasGenre(genres, /documentary|документ/i)) addP('🦉 познавательный фильм', 10);
            if (inAnyText(ovBoth, /soundtrack|music|composer|score|музык|композитор|саундтрек/i) || hasKw(ctx, /music|soundtrack|composer|score/)) addP('🎵 запоминающаяся музыка', 10);
            if (hasGenre(genres, /action|боевик|экшен/i)) addP('💥 яркий экшен', 10);
            if (meta.hasTrailer) addP('▶ есть трейлер — можно оценить за 2 минуты', 6);
            if (hasGenre(genres, /comedy|комедия/i)) addP('😂 поднимет настроение', 8);
            if (hasGenre(genres, /adventure|приключения/i)) addP('🌍 увлекательные приключения', 8);
            if (hasGenre(genres, /sci-fi|фантастика|fantasy|фэнтези/i)) addP('🚀 погрузит в фантастический мир', 8);
            if (hasGenre(genres, /drama|драма/i) && rating >= 7.5) addP('🎭 сильная актёрская игра', 8);
            
            if (rating > 0 && rating < cfg.min_rating && votes >= 100) addC('📉 оценки ниже вашего порога (' + rating.toFixed(1) + ')', 25);
            if (rating > 0 && rating < 5 && votes >= 50) addC('📉 низкие оценки зрителей (' + rating.toFixed(1) + ')', 30);
            
            if (mG.length) addC('⛔ нелюбимый жанр: ' + mG.join(', '), 40);
            if (mA.length) addC('⛔ нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '), 35);
            if (mD.length) addC('⛔ нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '), 35);

            if (fNudity) addC('🫣 есть сцены с наготой', 16);
            if (fSex) addC('💋 сексуальные сцены', 16);
            if (fDrugs) addC('💉 затрагивается тема наркотиков', 18);
            if (fViol) addC('🔪 жестокие и кровавые сцены', 18);
            if (fSmoke) addC('🚬 показано курение', 8);
            if (fAlcohol) addC('🍺 присутствует алкоголь', 10);
            if (fProfanity) addC('🤬 много нецензурной лексики', 10);
            if (fHate) addC('🚩 есть мотивы ненависти', 20);
            if (fGamb) addC('🎰 затрагивается тема азартных игр', 12);
            if (fSuicide) addC('⚠️ затрагивается тема суицида', 20);
            if (runtime > 180) addC('⌛ длительный фильм (' + runtime + ' мин)', 12);
            if (runtime > 150 && runtime <= 180) addC('⌛ довольно длинный (' + runtime + ' мин)', 8);
            if (/CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT|TELESYNC/i.test(q || '')) addC('📺 плохое качество изображения и звука', 28);
            
            if (age !== null && age >= 18) addC('🔞 только для взрослых (' + age + '+)', 15);
            else if (age !== null && age >= 16) addC('🔞 не для детей (' + age + '+)', 14);
            else if (age !== null && age >= 12) addC('🔞 рекомендуется с родителями (' + age + '+)', 10);
            
            if (isAnim && !familyOK && !isKnownFamily) {
                if (age !== null && age > 12) {
                    addC('🎭 мультфильм для взрослой аудитории (' + age + '+)', 16);
                } else {
                    addC('🎭 не детский мультфильм', 16);
                }
            }

            var score = 0;
            P.forEach(function(x){ score += x.w; });
            C.forEach(function(x){ score -= x.w; });
            if (score > 100) score = 100; if (score < -100) score = -100;
            var norm = Math.round((score + 100) / 2);
            
            var vClass = score >= 25 ? 'yes' : (score <= -25 ? 'no' : 'maybe');
            var vWord = score >= 25 ? 'СТОИТ' : (score <= -25 ? 'НЕ СТОИТ' : 'СПОРНО');

            var topP = P.slice().sort(function(a,b){ return b.w - a.w; })[0];
            var topC = C.slice().sort(function(a,b){ return b.w - a.w; })[0];
            function strip(t) { return t ? t.replace(/^[^\s]+\s/, '') : ''; }
            
            var reason = '';
            if (vClass === 'yes') {
                if (score >= 50) reason = 'Определённо стоит посмотреть' + (topP ? ' — ' + strip(topP.t) : '') + '.';
                else reason = 'Стоит посмотреть' + (topP ? ' — ' + strip(topP.t) : '') + '.';
            }
            else if (vClass === 'no') {
                if (score <= -50) reason = 'Лучше пропустить' + (topC ? ' — ' + strip(topC.t) : '') + '.';
                else reason = 'Не стоит тратить время' + (topC ? ' — ' + strip(topC.t) : '') + '.';
            }
            else {
                reason = 'Вердикт спорный' + (topP && topC ? ': за «' + strip(topP.t) + '», против «' + strip(topC.t) + '».' : '.') + ' Решайте сами.';
            }
            if (!dataRich) reason += ' Данных маловато — вердикт осторожный.';

            var pros = P.map(function(x){ return x.t; });
            var cons = C.map(function(x){ return x.t; });
            if (!pros.length) pros.push('ℹ️ данных недостаточно для рекомендации');
            if (!cons.length) cons.push((blG.length || blA.length || blD.length) ? '✅ под ваши фильтры ничего не попало' : '✅ явных минусов не выявлено');

            var audience = buildAudience(pros, cons, genres, rating, familyOK, age, isAnim, ctx, movieTitle, movieOriginalTitle);

            return {
                pros: pros, cons: cons, audience: audience,
                review: rt, score: score, norm: norm,
                vClass: vClass, vWord: vWord, reason: reason,
                mode: dataRich ? 'TMDB' : 'TAGS',
                familyOK: familyOK,
                age: age,
                isAnim: isAnim
            };
        });
    }

    /* ===== BACK / КОНТРОЛЛЕР ===== */
    function restorePrev() {
        var prev = window._sw_prevController; window._sw_prevController = null;
        try { if (prev && prev.name) Lampa.Controller.toggle(prev.name); else Lampa.Controller.toggle('full_start'); }
        catch(e) { try { Lampa.Controller.toggle('full'); } catch(_) {} }
    }
    function clearLoader() { if (window._sw_loaderTimer) { clearInterval(window._sw_loaderTimer); window._sw_loaderTimer = null; } }
    function registerController() {
        try {
            Lampa.Controller.add('should_watch_modal', {
                toggle: function() {
                    var h = window._sw_currentModalHtml;
                    if (!h) return;
                    if (h[0]) h[0].scrollTop = 0;
                    if (window._sw_blocknav) {
                        var blocks = h.find('.sw-focusable');
                        try { Lampa.Controller.collectionSet(blocks); } catch(e) {}
                        swSetFocus(0);
                        initNavPoints(h);
                    }
                },
                up: function() { 
                    if (window._sw_blocknav) {
                        if (window._sw_navPoints && window._sw_navPoints.length > 0) {
                            var newPoint = window._sw_currentNavPoint - 1;
                            if (newPoint < 0) newPoint = window._sw_navPoints.length - 1;
                            scrollToNavPoint(newPoint);
                        } else {
                            swSetFocus((window._sw_focusIdx || 0) - 1);
                        }
                    }
                },
                down: function() { 
                    if (window._sw_blocknav) {
                        if (window._sw_navPoints && window._sw_navPoints.length > 0) {
                            var newPoint = window._sw_currentNavPoint + 1;
                            if (newPoint >= window._sw_navPoints.length) newPoint = 0;
                            scrollToNavPoint(newPoint);
                        } else {
                            swSetFocus((window._sw_focusIdx || 0) + 1);
                        }
                    }
                },
                left: function() {}, 
                right: function() {},
                back: function() {
                    window._sw_rolling = false; 
                    window._sw_currentModalHtml = null; 
                    window._sw_focusIdx = 0; 
                    window._sw_scrollContainer = null;
                    window._sw_navPoints = [];
                    window._sw_currentNavPoint = 0;
                    clearLoader();
                    window._sw_closingFromController = true;
                    try { Lampa.Modal.close(); } catch(e) {}
                    restorePrev();
                }
            });
        } catch(e) { console.error('[SW] registerController:', e); }
    }

    /* ===== РЕНДЕР ===== */
    function buildReadyInner(a) {
        var badge = a.mode === 'TMDB'
            ? '<span class="sw-mode-badge tmdb"><span class="sw-mode-dot active"></span>TMDB</span>'
            : '<span class="sw-mode-badge tags"><span class="sw-mode-dot inactive"></span>TAGS</span>';
        var quote = '';
        if (a.review.sample) {
            var toneLabel = a.review.tone === 'pos' ? 'хвалебный' : (a.review.tone === 'neg' ? 'критический' : 'спорный');
            var toneCls = a.review.tone === 'pos' ? 'pos' : (a.review.tone === 'neg' ? 'neg' : 'mix');
            var txt = a.review.sample.text.length > 240 ? a.review.sample.text.substring(0, 240).trim() + '…' : a.review.sample.text;
            quote = '<div class="sw-quote sw-focusable" tabindex="0"><div class="sw-quote-text">' + esc(txt) + '</div><div class="sw-quote-meta">— ' + esc(a.review.sample.author) + ', отзыв зрителя<span class="sw-quote-tone ' + toneCls + '">' + toneLabel + '</span></div></div>';
        }
        return '' +
            '<div class="sw-dossier sw-focusable sw-nav-point" tabindex="0">' + badge +
                '<div class="sw-verdict-word ' + a.vClass + '">' + a.vWord + '</div>' +
                '<div class="sw-verdict-reason">' + esc(a.reason) + '</div>' +
                '<div class="sw-meter"><div class="sw-meter-fill ' + a.vClass + '" data-w="' + a.norm + '"></div></div>' +
            '</div>' +
            '<div class="sw-columns sw-nav-point">' +
                '<div class="sw-col sw-focusable" tabindex="0"><div class="sw-title pros">✓ Аргументы за</div><ul class="sw-list">' + a.pros.map(function(p, i){ return '<li style="animation-delay:' + (i * 0.05) + 's">' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
                '<div class="sw-col sw-focusable" tabindex="0"><div class="sw-title cons">✗ Аргументы против</div><ul class="sw-list">' + a.cons.map(function(c, i){ return '<li style="animation-delay:' + (i * 0.05) + 's">' + esc(c) + '</li>'; }).join('') + '</ul></div>' +
            '</div>' +
            quote +
            '<div class="sw-target-audience sw-focusable sw-nav-point" tabindex="0"><div class="sw-title target">🎯 Кому понравится</div><div class="sw-aud-text">' + esc(a.audience) + '</div></div>' +
            '<div class="sw-decision sw-nav-point">' +
                '<div class="sw-decision-hint">Вердикт выше — а если колеблешься, доверься случаю</div>' +
                '<div class="sw-dice-btn selector sw-focusable" id="sw-dice-btn" tabindex="0"><span style="font-size:1.4em">🎲</span> Бросить кости</div>' +
                '<div class="sw-verdict-roll" id="sw-verdict"></div>' +
            '</div>';
    }
    function bindDice(html) {
        html.find('#sw-dice-btn').on('hover:enter click keydown', function(e) {
            try {
                if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                if (window._sw_rolling) return; window._sw_rolling = true;
                var btn = $(this), v = html.find('#sw-verdict');
                v.attr('style', '').attr('class', 'sw-verdict-roll').text(''); 
                btn.addClass('shake');
                setTimeout(function() {
                    try {
                        btn.removeClass('shake');
                        if (Math.random() > 0.5) 
                            v.text('Смотреть!').addClass('verdict-yes').css({color:'#85c25e',textShadow:'0 0 12px rgba(133,194,94,.35)'});
                        else 
                            v.text('Не смотреть').addClass('verdict-no').css({color:'#d9534f',textShadow:'0 0 12px rgba(217,83,79,.35)'});
                        Lampa.Controller.collectionFocus(btn);
                        try { btn[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(_) {}
                    } catch(err) { console.error('[SW] dice render:', err); }
                    window._sw_rolling = false;
                }, 500);
            } catch(err) { console.error('[SW] dice handler:', err); window._sw_rolling = false; }
        });
    }

    function showModal(movie) {
        try {
            var title = esc(movie.title || movie.name || 'Фильм');
            try { window._sw_prevController = Lampa.Controller.enabled ? Lampa.Controller.enabled() : null; } catch(e) { window._sw_prevController = null; }
            var phrases = ['Анализирую фильм...', 'Подгружаю данные с TMDB...', 'Читаю отзывы зрителей...', 'Проверяю ценз и теги...', 'Взвешиваю аргументы...'];
            var html = $('<div class="sw-modal-content"><div id="sw-body"><div class="sw-loader"><div class="sw-loader-dice">🎲</div><div class="sw-loader-text" id="sw-loader-text">' + phrases[0] + '</div><div class="sw-loader-bar"></div></div></div></div>');
            window._sw_currentModalHtml = html;
            window._sw_focusIdx = 0;
            window._sw_scrollContainer = html;
            window._sw_navPoints = [];
            window._sw_currentNavPoint = 0;
            var pi = 0;
            window._sw_loaderTimer = setInterval(function() {
                pi = (pi + 1) % phrases.length; var t = html.find('#sw-loader-text');
                if (t.length) { t.css('opacity', 0); setTimeout(function(){ t.text(phrases[pi]).css('opacity', 1); }, 200); }
            }, 750);

            Lampa.Modal.open({
                title: 'Стоит ли смотреть: ' + title, 
                html: html, 
                size: 'large', 
                onBack: function() {
                    window._sw_rolling = false; 
                    window._sw_currentModalHtml = null; 
                    window._sw_focusIdx = 0; 
                    window._sw_scrollContainer = null;
                    window._sw_navPoints = [];
                    window._sw_currentNavPoint = 0;
                    clearLoader();
                    if (window._sw_closingFromController) { window._sw_closingFromController = false; return; }
                    restorePrev();
                }
            });

            analyze(movie).then(function(a) {
                clearLoader();
                html.find('#sw-body').html('<div class="sw-body">' + buildReadyInner(a) + '</div>');
                bindDice(html);
                setTimeout(function() { 
                    html.find('.sw-meter-fill').each(function(){ 
                        this.style.width = (this.getAttribute('data-w') || 50) + '%'; 
                    }); 
                }, 120);
                Lampa.Controller.toggle('should_watch_modal');
            }).catch(function(err) {
                clearLoader();
                console.error('[SW] analyze:', err);
                html.find('#sw-body').html('<div class="sw-body" style="text-align:center;padding:40px;color:#d9534f">Ошибка анализа. Попробуйте позже.</div>');
            });
        } catch(e) { console.error('[SW] showModal:', e); }
    }

    /* ===== ИНЪЕКЦИЯ ===== */
    function addBtn(el, movie) {
        try {
            if (!el || !el.length || el.find('.sw-custom-button').length) return;
            var btn = $('<div class="full-start__button selector sw-custom-button" data-type="should_watch"><div class="full-start__icon">' + ICON + '</div><span>Стоит ли?</span></div>');
            btn.on('hover:enter', function() { if (movie) showModal(movie); });
            var anchor = el.find('.view--torrent,.view--online,.view--trailer').last();
            if (anchor.length) anchor.after(btn);
            else { var fb = el.find('.full-start__buttons,.full-start-new__buttons,.full-card__buttons'); if (fb.length) fb.append(btn); }
        } catch(e) { console.error('[SW] addBtn:', e); }
    }

    function startPlugin() {
        try {
            var ua = navigator.userAgent || '';
            var hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            var isTV = /TV|SmartTV|HbbTV|Web0S|webOS|Tizen|NetCast|Viera|BRAVIA|CrKey|AFT|FireTV|POVIDE|Maple/i.test(ua);
            window._sw_blocknav = !hasTouch || isTV;
        } catch(e) { window._sw_blocknav = true; }
        try { registerController(); } catch(e) {}
        try { Lampa.Listener.follow('full', function(e) { 
            if (e.type !== 'complite') return; 
            try { 
                var renderEl = (e.object && e.object.render) ? e.object.render() : (e.object && e.object.activity && e.object.activity.render ? e.object.activity.render() : null);
                if (renderEl) addBtn(renderEl, e.data.movie); 
            } catch(err) { console.error('[SW]', err); } 
        }); } catch(e) {}
        try { initSettings(); } catch(e) {}
        try { injectCSS(); } catch(e) {}
        console.log('[ShouldWatch] v25.1 (Fixed logic, native TV scroll, Lampa network).');
    }
    try { if (window.appready) startPlugin(); else Lampa.Listener.follow('app', function(e){ if (e.type === 'ready') startPlugin(); }); } catch(e) {}
})();
