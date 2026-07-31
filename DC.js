(function () {
    'use strict';

    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;

    var PLUGIN_ID = 'should_watch_plugin';
    var ICON = '<svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="8" stroke-linecap="square" fill="none"><path d="M20,55 L40,75 L80,25"/><path d="M25,25 L75,75" stroke-dasharray="4,4"/></g></svg>';

    window._sw_rolling = false;
    window._sw_currentModalHtml = null;
    window._sw_prevController = null;

    /* ==========================================================================
       НАСТРОЙКИ
       ========================================================================== */

    function getSetting(key, def) {
        try {
            var val = Lampa.Storage.get(PLUGIN_ID + '_' + key);
            if (val !== undefined && val !== null && val !== '') return val;
        } catch(e) {}
        return def;
    }
    function saveSetting(key, value) {
        try { Lampa.Storage.set(PLUGIN_ID + '_' + key, value); } catch(e) {}
    }
    function getSettings() {
        return {
            bad_genres: String(getSetting('bad_genres', '') || ''),
            bad_actors: String(getSetting('bad_actors', '') || ''),
            bad_directors: String(getSetting('bad_directors', '') || ''),
            min_rating: parseFloat(getSetting('min_rating', '6')) || 6
        };
    }
    function parseBL(str) {
        if (!str || typeof str !== 'string') return [];
        return str.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
    }
    function initSettings() {
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
                field: { name: p.title, description: p.description },
                onChange: function(val) { saveSetting(p.name, val); }
            });
        });
    }

    /* ==========================================================================
       СТИЛИ
       ========================================================================== */

    function injectCSS() {
        if (document.getElementById('sw-plugin-styles')) return;
        var s = document.createElement('style');
        s.id = 'sw-plugin-styles';
        s.innerHTML =
            '.sw-modal-content{padding:20px;color:#fff;font-family:sans-serif;max-height:72vh;overflow-y:auto;scroll-behavior:smooth}' +
            '.sw-modal-content::-webkit-scrollbar{width:5px}' +
            '.sw-modal-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:3px}' +
            '.sw-dice-section{text-align:center;margin-bottom:30px;padding:20px;background:rgba(255,255,255,.03);border-radius:12px}' +
            '.sw-dice-btn{background:#eadecd;color:#1a1a1a;font-size:1.4em;font-weight:bold;padding:15px 40px;border-radius:30px;display:inline-flex;align-items:center;gap:15px;transition:transform .2s,background .2s,box-shadow .2s;cursor:pointer;outline:none;border:3px solid transparent}' +
            '.sw-dice-btn.focus{background:#fff;transform:scale(1.05);box-shadow:0 0 0 3px #fff,0 0 20px rgba(255,255,255,.4);border-color:#fff}' +
            '.sw-dice-btn.shake{animation:swShake .5s}' +
            '.sw-verdict{margin-top:15px;font-size:1.6em;font-weight:bold;min-height:40px;text-transform:uppercase}' +
            '.sw-verdict.verdict-yes{color:#85c25e!important;text-shadow:0 0 10px rgba(133,194,94,.3)}' +
            '.sw-verdict.verdict-no{color:#d9534f!important;text-shadow:0 0 10px rgba(217,83,79,.3)}' +
            '.sw-columns{display:flex;justify-content:space-between;gap:20px;margin-bottom:25px}' +
            '.sw-col{flex:1;background:rgba(255,255,255,.05);padding:15px;border-radius:10px}' +
            '.sw-title{font-size:1.1em;font-weight:bold;margin-bottom:15px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:10px}' +
            '.sw-title.pros{color:#85c25e}.sw-title.cons{color:#d9534f}.sw-title.target{color:#e0e0e0}' +
            '.sw-list{margin:0;padding-left:20px;font-size:.95em;line-height:1.5;color:#ccc}' +
            '.sw-list li{margin-bottom:10px}' +
            '.sw-target-audience{background:rgba(255,255,255,.05);padding:20px;border-radius:10px;line-height:1.6;color:#ddd;font-size:1.05em}' +
            '@keyframes swShake{0%,100%{transform:translate(1px,-2px) rotate(-1deg)}10%,30%,50%,70%,90%{transform:translate(-1px,2px) rotate(1deg)}20%,40%,60%,80%{transform:translate(-3px,0) rotate(0deg)}}';
        document.head.appendChild(s);
    }

    /* ==========================================================================
       УТИЛИТЫ
       ========================================================================== */

    function esc(s) { return typeof s === 'string' ? $('<div>').text(s).html() : ''; }
    function loadCredits(movie) {
        if (movie.credits && ((movie.credits.cast && movie.credits.cast.length) || (movie.credits.crew && movie.credits.crew.length))) return Promise.resolve(movie.credits);
        var id = movie.id || movie.tmdb_id;
        if (!id) return Promise.resolve(null);
        if (Lampa.TMDB && typeof Lampa.TMDB.credits === 'function') {
            return new Promise(function(resolve) {
                Lampa.TMDB.credits(id, function(data) { resolve(data && !data.status_code ? data : null); }, function() { resolve(null); });
            });
        }
        return Promise.resolve(null);
    }
    function hasGenre(genres, re) { return genres.some(function(g){ return re.test(g); }); }
    function inText(str, re) { return re.test((str || '').toLowerCase()); }

    /* ==========================================================================
       ШАБЛОНЫ (все test(m, ctx))
       ctx = { cfg, q, genres, cast, dirs, wrts, rating, votes, runtime, ov }
       ========================================================================== */

    var PROS_TEMPLATES = [
        { emoji: '⭐', text: 'высокий рейтинг ({rating})', test: function(m,c){ return c.rating >= c.cfg.min_rating && c.votes >= 100; } },
        { emoji: '🎵', text: 'хорошая музыкальная составляющая', test: function(m,c){ return inText(c.ov, /soundtrack|music|composer|score|музык|композитор/); } },
        { emoji: '💥', text: 'впечатляющие экшен-сцены', test: function(m,c){ return hasGenre(c.genres, /action|боевик/i); } },
        // СЕМЕЙНЫЙ: только явный family/animation, либо комедия БЕЗ тёмных жанров
        { emoji: '🤱🏼', text: 'подойдет для семейного просмотра', test: function(m,c){
            var fam = hasGenre(c.genres, /family|animation|семейн|мульт|детск/i);
            var dark = hasGenre(c.genres, /crime|thriller|horror|криминал|триллер|ужас/i);
            var com = hasGenre(c.genres, /comedy|комед/i);
            return fam || (com && !dark && !m.adult && c.rating >= 6.5);
        } },
        { emoji: '🦫', text: 'полезная информация', test: function(m,c){ return hasGenre(c.genres, /documentary|документ/i); } },
        { emoji: '🎥', text: 'отличное качество видео ({quality})', test: function(m,c){ return c.q && !/CAM|TS|HDCAM|SCR|WORKPRINT/i.test(c.q); } },
        { emoji: '🕐', text: 'комфортный хронометраж ({runtime} мин.)', test: function(m,c){ return c.runtime > 0 && c.runtime <= 130; } },
        { emoji: '🏳️', text: 'дружба народов', test: function(m,c){ return (m.origin_country||[]).length > 2; } },
        // НАХОДКА: строгий прокси признания, БЕЗ выдуманного номера
        { emoji: '🔎', text: 'находка — в числе лучших по оценкам', test: function(m,c){ return c.rating >= 8.0 && c.votes >= 3000; } },
        { emoji: '🔥', text: 'горячие новинки', test: function(m,c){ var y=m.release_date?parseInt(m.release_date.substring(0,4)):0; return y >= new Date().getFullYear()-1; } }
    ];

    var CONS_TEMPLATES = [
        { emoji: '💋', text: 'откровенные сцены', test: function(m,c){ return !!m.adult || inText(c.ov, /\bsex\b|nudity|обнаж|эротик|откровен/); } },
        { emoji: '🚬', text: 'курение или употребление алкоголя', test: function(m,c){ return inText(c.ov, /smok|alcohol|\bdrink\b|пьян|курени|выпив/); } },
        { emoji: '🎰', text: 'игромания', test: function(m,c){ return inText(c.ov, /casino|gambl|казино|ставк|\bbet\b|рулетк/); } },
        // ЖЕСТОКОСТЬ: слова ИЛИ связка жанров crime+thriller ИЛИ horror
        { emoji: '🔪', text: 'жестокие сцены', test: function(m,c){
            var words = inText(c.ov, /violenc|gore|murder|убийств|кров|жесток|насил|оружи|стрельб|weapon/);
            var crime = hasGenre(c.genres, /crime|криминал/i);
            var thr = hasGenre(c.genres, /thriller|триллер/i);
            var hor = hasGenre(c.genres, /horror|ужас/i);
            return words || hor || (crime && thr);
        } },
        { emoji: '⌛', text: 'высокий хронометраж ({runtime} мин.)', test: function(m,c){ return c.runtime > 180; } },
        // НАРКОТИКИ: расширенный словарь (метамфетамин/варк/meth...)
        { emoji: '💉', text: 'употребление наркотиков', test: function(m,c){ return inText(c.ov, /метамфетамин|варк|meth|кокаин|cocaine|героин|heroin|наркот|марихуан|каннабис|опиум|амфетамин/); } },
        { emoji: '📺', text: 'низкое качество видео ({quality})', test: function(m,c){ return /CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT/i.test(c.q || ''); } },
        { emoji: '🚩', text: 'разжигание ненависти', test: function(m,c){ return inText(c.ov, /hate|racis|нацист|расизм|ненавист/); } }
    ];

    var AUDIENCE_WORDS = [
        { word: 'экшена', test: function(m,c){ return hasGenre(c.genres, /action|боевик/i); } },
        { word: 'качества картинки', test: function(m,c){ return c.q && !/CAM|TS|HDCAM|SCR/i.test(c.q); } },
        { word: 'хорошей музыки', test: function(m,c){ return inText(c.ov, /soundtrack|music|composer|score|музык/); } },
        { word: 'полезного времяпровождения', test: function(m,c){ return hasGenre(c.genres, /documentary|документ/i); } },
        { word: 'испытать свои нервы', test: function(m,c){ return hasGenre(c.genres, /thriller|horror|триллер|ужас/i); } },
        { word: 'семейного вечера', test: function(m,c){ return hasGenre(c.genres, /family|animation|семейн|мульт/i); } },
        { word: 'новинки', test: function(m,c){ var y=m.release_date?parseInt(m.release_date.substring(0,4)):0; return y >= new Date().getFullYear()-1; } },
        { word: 'драмы', test: function(m,c){ return hasGenre(c.genres, /drama|драма/i); } },
        { word: 'комедии', test: function(m,c){ return hasGenre(c.genres, /comedy|комед/i); } },
        { word: 'фантастики', test: function(m,c){ return hasGenre(c.genres, /sci-fi|fantasy|фантастик/i); } }
    ];

    /* ==========================================================================
       АНАЛИЗАТОР
       ========================================================================== */

    function analyze(movie) {
        return loadCredits(movie).then(function(credits) {
            var cfg = getSettings();
            var blG = parseBL(cfg.bad_genres), blA = parseBL(cfg.bad_actors), blD = parseBL(cfg.bad_directors);

            var q = (movie.quality || movie.source_quality || '').toString().toUpperCase();
            var rating = parseFloat(movie.vote_average) || 0;
            var votes = parseInt(movie.vote_count) || 0;
            var runtime = parseInt(movie.runtime) || 0;
            var genres = (movie.genres || []).map(function(g){ return g.name; }).filter(Boolean);
            var ov = (movie.overview || '').trim();

            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){ return c.name; }).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){ return c.job === 'Director'; }).map(function(c){ return c.name; }).filter(Boolean);
            var wrts = crew.filter(function(c){ return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0; }).map(function(c){ return c.name; }).filter(Boolean);

            var ctx = { cfg:cfg, q:q, genres:genres, cast:cast, dirs:dirs, wrts:wrts, rating:rating, votes:votes, runtime:runtime, ov:ov };

            var P = [], C = [];

            PROS_TEMPLATES.forEach(function(t) {
                try { if (t.test(movie, ctx)) P.push(t.emoji + ' ' + t.text.replace('{rating}', rating.toFixed(1)).replace('{runtime}', runtime).replace('{quality}', q || 'HD')); } catch(e) {}
            });

            // Чёрные списки -> в МИНУСЫ
            var mG = genres.filter(function(g){ var gl=g.toLowerCase(); return blG.some(function(b){ return gl.indexOf(b) >= 0; }); });
            var mA = cast.filter(function(a){ var al=a.toLowerCase(); return blA.some(function(b){ return al.indexOf(b) >= 0; }); });
            var mD = [].concat(dirs, wrts).filter(function(p){ var pl=p.toLowerCase(); return blD.some(function(b){ return pl.indexOf(b) >= 0; }); });
            if (mG.length) C.push('⛔ Нелюбимый жанр: ' + mG.join(', '));
            if (mA.length) C.push('⛔ Нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '));
            if (mD.length) C.push('⛔ Нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '));

            CONS_TEMPLATES.forEach(function(t) {
                try { if (t.test(movie, ctx)) C.push(t.emoji + ' ' + t.text.replace('{runtime}', runtime).replace('{quality}', q || '')); } catch(e) {}
            });

            if (!P.length) P.push('ℹ️ Недостаточно метаданных');
            if (!C.length) C.push('✅ Противопоказаний не выявлено');

            var matched = [];
            AUDIENCE_WORDS.forEach(function(w) { try { if (w.test(movie, ctx)) matched.push(w.word); } catch(e) {} });
            var audience = matched.length
                ? 'Любителям ' + matched.slice().sort(function(){ return Math.random()-0.5; }).join(', ') + '.'
                : 'Любителям кино без особых предпочтений.';

            return { pros: P, cons: C, audience: audience };
        });
    }

    /* ==========================================================================
       КОНТРОЛЛЕР (скролл без телепортации + корректный Back)
       ========================================================================== */

    function registerController() {
        Lampa.Controller.add('should_watch_modal', {
            toggle: function() {
                var h = window._sw_currentModalHtml;
                if (h) {
                    Lampa.Controller.collectionSet(h);
                    var b = h.find('#sw-dice-btn');
                    if (b.length) Lampa.Controller.collectionFocus(b);
                }
            },
            up: function() {
                var h = window._sw_currentModalHtml;
                if (h && h[0] && h[0].scrollTop > 0) h[0].scrollBy({ top: -120, behavior: 'smooth' });
            },
            down: function() {
                var h = window._sw_currentModalHtml;
                if (h && h[0]) h[0].scrollBy({ top: 120, behavior: 'smooth' });
            },
            left: function() {},
            right: function() {},
            back: function() {
                window._sw_rolling = false;
                window._sw_currentModalHtml = null;
                var prev = window._sw_prevController;
                window._sw_prevController = null;
                try { Lampa.Modal.close(); } catch(e) {}
                try {
                    if (prev && prev.name) Lampa.Controller.toggle(prev.name);
                    else Lampa.Controller.toggle('full_start');
                } catch(e) {
                    try { Lampa.Controller.toggle('full'); } catch(_) {}
                }
            }
        });
    }

    /* ==========================================================================
       МОДАЛКА (один open, без update -> Back не ломается)
       ========================================================================== */

    function showModal(movie) {
        var title = esc(movie.title || movie.name || 'Фильм');

        // Запоминаем контроллер карточки ДО открытия
        try { window._sw_prevController = Lampa.Controller.enabled ? Lampa.Controller.enabled() : null; } catch(e) { window._sw_prevController = null; }

        // Глобальный лоадер вместо loading-модалки (канон Opinions)
        try { Lampa.Loading.start(); } catch(e) {}

        analyze(movie).then(function(a) {
            try { Lampa.Loading.stop(); } catch(e) {}

            var html = $(
                '<div class="sw-modal-content">' +
                    '<div class="sw-dice-section">' +
                        '<div class="sw-dice-btn selector" id="sw-dice-btn"><span style="font-size:1.5em">🎲</span> Бросить кости</div>' +
                        '<div class="sw-verdict" id="sw-verdict"></div>' +
                    '</div>' +
                    '<div class="sw-columns">' +
                        '<div class="sw-col"><div class="sw-title pros">Почему стоит ✓</div><ul class="sw-list">' + a.pros.map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
                        '<div class="sw-col"><div class="sw-title cons">Почему не стоит ✗</div><ul class="sw-list">' + a.cons.map(function(c){ return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>' +
                    '</div>' +
                    '<div class="sw-target-audience"><div class="sw-title target">Кому посмотреть? 🎯</div><div>' + esc(a.audience) + '</div></div>' +
                '</div>'
            );

            window._sw_currentModalHtml = html;

            html.find('#sw-dice-btn').on('hover:enter click keydown', function(e) {
                try {
                    if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                    if (window._sw_rolling) return;
                    window._sw_rolling = true;
                    var btn = $(this), v = html.find('#sw-verdict');
                    v.attr('style', '').attr('class', 'sw-verdict').text('');
                    btn.addClass('shake');
                    setTimeout(function() {
                        try {
                            btn.removeClass('shake');
                            if (Math.random() > 0.5) v.text('Смотреть!').addClass('verdict-yes').css({color:'#85c25e',textShadow:'0 0 10px rgba(133,194,94,.3)'});
                            else v.text('Не смотреть').addClass('verdict-no').css({color:'#d9534f',textShadow:'0 0 10px rgba(217,83,79,.3)'});
                            Lampa.Controller.collectionFocus(btn);
                        } catch(err) { console.error('[SW] dice render:', err); }
                        window._sw_rolling = false;
                    }, 500);
                } catch(err) { console.error('[SW] dice handler:', err); window._sw_rolling = false; }
            });

            // ЕДИНСТВЕННЫЙ open, без update — onBack и состояние не сбрасываются
            Lampa.Modal.open({
                title: 'Стоит ли смотреть: ' + title,
                html: html,
                size: 'large',
                zIndex: 1000,
                onBack: function() {
                    window._sw_rolling = false;
                    window._sw_currentModalHtml = null;
                    var prev = window._sw_prevController;
                    window._sw_prevController = null;
                    try {
                        if (prev && prev.name) Lampa.Controller.toggle(prev.name);
                        else Lampa.Controller.toggle('full_start');
                    } catch(e) { try { Lampa.Controller.toggle('full'); } catch(_) {} }
                }
            });

            Lampa.Controller.toggle('should_watch_modal');
        }).catch(function(err) {
            try { Lampa.Loading.stop(); } catch(e) {}
            console.error('[SW] analyze:', err);
        });
    }

    /* ==========================================================================
       ИНЪЕКЦИЯ КНОПКИ
       ========================================================================== */

    function addBtn(el, movie) {
        if (!el || !el.length || el.find('.sw-custom-button').length) return;
        var btn = $('<div class="full-start__button selector sw-custom-button" data-type="should_watch"><div class="full-start__icon">' + ICON + '</div><span>Стоит ли?</span></div>');
        btn.on('hover:enter', function() { if (movie) showModal(movie); });
        var anchor = el.find('.view--torrent,.view--online,.view--trailer').last();
        if (anchor.length) anchor.after(btn);
        else {
            var fb = el.find('.full-start__buttons,.full-start-new__buttons,.full-card__buttons');
            if (fb.length) fb.append(btn);
        }
    }

    /* ==========================================================================
       ЗАПУСК
       ========================================================================== */

    function startPlugin() {
        try { registerController(); } catch(err) {}
        try {
            Lampa.Listener.follow('full', function(e) {
                if (e.type !== 'complite') return;
                try { addBtn(e.object.activity.render(), e.data.movie); } catch(err) { console.error('[SW]', err); }
            });
        } catch(err) {}
        try { initSettings(); } catch(err) {}
        try { injectCSS(); } catch(err) {}
        console.log('[ShouldWatch] v9.2 initialized.');
    }

    try {
        if (window.appready) startPlugin();
        else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') startPlugin(); });
    } catch(e) {}

})();
