(function () {
    'use strict';

    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;

    var PLUGIN_ID = 'should_watch_plugin';
    var ICON = '<svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="8" stroke-linecap="square" fill="none"><path d="M20,55 L40,75 L80,25"/><path d="M25,25 L75,75" stroke-dasharray="4,4"/></g></svg>';

    /* ==========================================================================
       НАСТРОЙКИ
       ========================================================================== */

    function getSetting(key, def) {
        try {
            var fullKey = PLUGIN_ID + '_' + key;
            var val = Lampa.Storage.get(fullKey);
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
        var params = [
            { name: 'bad_genres', type: 'input', title: 'Нелюбимые жанры', description: 'Через запятую', default: '' },
            { name: 'bad_actors', type: 'input', title: 'Нелюбимые актёры', description: 'Через запятую', default: '' },
            { name: 'bad_directors', type: 'input', title: 'Нелюбимые авторы', description: 'Через запятую', default: '' },
            { name: 'min_rating', type: 'select', title: 'Мин. рейтинг', values: {'0':'Любой','5':'5.0','6':'6.0','7':'7.0','8':'8.0'}, default: '6' }
        ];
        params.forEach(function(p) {
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
            '.sw-modal-content{padding:20px;color:#fff;font-family:sans-serif}' +
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
       УТИЛИТЫ И CREDITS
       ========================================================================== */

    function esc(s) { return typeof s === 'string' ? $('<div>').text(s).html() : ''; }

    function loadCredits(movie) {
        if (movie.credits && ((movie.credits.cast && movie.credits.cast.length) || (movie.credits.crew && movie.credits.crew.length))) {
            return Promise.resolve(movie.credits);
        }
        var id = movie.id || movie.tmdb_id;
        if (!id) return Promise.resolve(null);
        if (Lampa.TMDB && typeof Lampa.TMDB.credits === 'function') {
            return new Promise(function(resolve) {
                Lampa.TMDB.credits(id, function(data) { resolve(data && !data.status_code ? data : null); }, function() { resolve(null); });
            });
        }
        return Promise.resolve(null);
    }

    /* ==========================================================================
       АНАЛИЗАТОР v9
       ЗАМЕНИТЕ text в массивах ниже на свои цепочки.
       Плейсхолдеры: {rating} {votes} {runtime} {quality} {rank} {genres}
       ========================================================================== */

    var PROS_TEMPLATES = [
        { id: 'rating',    emoji: '⭐', text: 'высокий рейтинг ({rating})',           test: function(m,cfg){ return m.vote_average >= cfg.min_rating && m.vote_count >= 100; } },
        { id: 'music',     emoji: '🎵', text: 'хорошая музыкальная составляющая',      test: function(m){ return /soundtrack|music|composer|score/i.test(m.overview||''); } },
        { id: 'action',    emoji: '💥', text: 'впечатляющие экшен-сцены',              test: function(m){ return (m.genres||[]).some(function(g){return /action|боевик/i.test(g.name);}); } },
        { id: 'family',    emoji: '🤱🏼', text: 'подойдет для семейного просмотра',      test: function(m){ return !m.adult && (m.vote_average||0) >= 6; } },
        { id: 'info',      emoji: '🦫', text: 'полезная информация',                   test: function(m){ return (m.genres||[]).some(function(g){return /documentary|документ/i.test(g.name);}); } },
        { id: 'quality',   emoji: '🎥', text: 'отличное качество видео ({quality})',   test: function(m,q){ return q && !/CAM|TS|HDCAM|SCR/i.test(q); } },
        { id: 'runtime',   emoji: '🕐', text: 'комфортный хронометраж ({runtime} мин.)', test: function(m){ return m.runtime > 0 && m.runtime <= 130; } },
        { id: 'diversity', emoji: '🏳️', text: 'дружба народов',                        test: function(m){ return (m.origin_country||[]).length > 2; } },
        { id: 'top100',    emoji: '🔎', text: 'находка (место в топ 100)',             test: function(m){ return m.popularity >= 500; } },
        { id: 'new',       emoji: '🔥', text: 'горячие новинки',                       test: function(m){ var y=m.release_date?parseInt(m.release_date.substring(0,4)):0; return y>=new Date().getFullYear()-1; } }
    ];

    var CONS_TEMPLATES = [
        { id: 'adult',     emoji: '💋', text: 'откровенные сцены',                     test: function(m){ return !!m.adult; } },
        { id: 'smoking',   emoji: '🚬', text: 'курение или употребление алкоголя',     test: function(m){ return /smok|alcohol|drink|пьян|курени/i.test(m.overview||''); } },
        { id: 'gambling',  emoji: '🎰', text: 'игромания',                             test: function(m){ return /casino|gambl|казино|ставк|bet/i.test((m.overview||'').toLowerCase()); } },
        { id: 'violence',  emoji: '🔪', text: 'жестокие сцены',                        test: function(m){ return /violenc|gore|murder|убийств|кров|жесток/i.test((m.overview||'').toLowerCase()); } },
        { id: 'long',      emoji: '⌛', text: 'высокий хронометраж ({runtime} мин.)',   test: function(m){ return m.runtime > 180; } },
        { id: 'drugs',     emoji: '💉', text: 'употребление наркотиков',               test: function(m){ return /drug|наркот|heroin|cocaine/i.test((m.overview||'').toLowerCase()); } },
        { id: 'badquality',emoji: '📺', text: 'низкое качество видео ({quality})',     test: function(m,q){ return /CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT/i.test(q||''); } },
        { id: 'hate',      emoji: '🚩', text: 'разжигание ненависти',                  test: function(m){ return /hate|racis|нацист|расизм|ненавист/i.test((m.overview||'').toLowerCase()); } }
    ];

    // Слова для рандомной сборки «Кому подходит»
    var AUDIENCE_WORDS = [
        { word: 'экшена',                    test: function(m){ return (m.genres||[]).some(function(g){return /action|боевик/i.test(g.name);}); } },
        { word: 'качества картинки',         test: function(m,q){ return q && !/CAM|TS|HDCAM|SCR/i.test(q); } },
        { word: 'хорошей музыки',            test: function(m){ return /soundtrack|music|composer|score/i.test(m.overview||''); } },
        { word: 'полезного времяпровождения',test: function(m){ return (m.genres||[]).some(function(g){return /documentary|документ/i.test(g.name);}); } },
        { word: 'испытать свои нервы',       test: function(m){ return /thriller|horror|триллер|ужас/i.test((m.genres||[]).map(function(g){return g.name;}).join(' ')); } },
        { word: 'семейного вечера',          test: function(m){ return !m.adult && (m.vote_average||0) >= 6; } },
        { word: 'новинки',                   test: function(m){ var y=m.release_date?parseInt(m.release_date.substring(0,4)):0; return y>=new Date().getFullYear()-1; } },
        { word: 'драмы',                     test: function(m){ return (m.genres||[]).some(function(g){return /drama|драма/i.test(g.name);}); } },
        { word: 'комедии',                   test: function(m){ return (m.genres||[]).some(function(g){return /comedy|комеди/i.test(g.name);}); } },
        { word: 'фантастики',                test: function(m){ return (m.genres||[]).some(function(g){return /sci-fi|fantasy|фантастик/i.test(g.name);}); } }
    ];

    function analyze(movie) {
        return loadCredits(movie).then(function(credits) {
            var cfg = getSettings();
            var blG = parseBL(cfg.bad_genres);
            var blA = parseBL(cfg.bad_actors);
            var blD = parseBL(cfg.bad_directors);

            var qualityStr = (movie.quality || movie.source_quality || '').toString().toUpperCase();
            var rating = parseFloat(movie.vote_average) || 0;
            var votes = parseInt(movie.vote_count) || 0;
            var runtime = parseInt(movie.runtime) || 0;

            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){return c.name;}).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){return c.job === 'Director';}).map(function(c){return c.name;}).filter(Boolean);
            var wrts = crew.filter(function(c){return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0;}).map(function(c){return c.name;}).filter(Boolean);

            // Сборка плюсов
            var P = [];
            PROS_TEMPLATES.forEach(function(t) {
                if (t.test(movie, cfg)) {
                    var txt = t.text
                        .replace('{rating}', rating.toFixed(1))
                        .replace('{votes}', votes)
                        .replace('{runtime}', runtime)
                        .replace('{quality}', qualityStr || 'HD');
                    P.push(t.emoji + ' ' + txt);
                }
            });

            // Чёрные списки
            var genres = (movie.genres||[]).map(function(g){return g.name;}).filter(Boolean);
            var mG = genres.filter(function(g){ var gl=g.toLowerCase(); return blG.some(function(b){return gl.indexOf(b)>=0;}); });
            var mA = cast.filter(function(a){ var al=a.toLowerCase(); return blA.some(function(b){return al.indexOf(b)>=0;}); });
            var mD = [].concat(dirs,wrts).filter(function(p){ var pl=p.toLowerCase(); return blD.some(function(b){return pl.indexOf(b)>=0;}); });
            if (mG.length) P.push('⛔ Нелюбимый жанр: ' + mG.join(', '));
            if (mA.length) P.push('⛔ Нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '));
            if (mD.length) P.push('⛔ Нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '));

            // Сборка минусов
            var C = [];
            CONS_TEMPLATES.forEach(function(t) {
                if (t.test(movie, cfg)) {
                    var txt = t.text
                        .replace('{rating}', rating.toFixed(1))
                        .replace('{runtime}', runtime)
                        .replace('{quality}', qualityStr || '');
                    C.push(t.emoji + ' ' + txt);
                }
            });

            if (!P.length) P.push('ℹ️ Недостаточно метаданных');
            if (!C.length) C.push('✅ Противопоказаний не выявлено');

            // Рандомная сборка «Кому подходит»
            var matchedWords = [];
            AUDIENCE_WORDS.forEach(function(w) {
                if (w.test(movie, qualityStr)) matchedWords.push(w.word);
            });

            var audience;
            if (matchedWords.length > 0) {
                // Перемешиваем массив слов для рандомного порядка
                var shuffled = matchedWords.slice().sort(function(){return Math.random()-0.5;});
                audience = 'Любителям ' + shuffled.join(', ') + '.';
            } else {
                audience = 'Любителям кино без особых предпочтений.';
            }

            return { pros: P, cons: C, audience: audience };
        });
    }

    /* ==========================================================================
       МОДАЛКА (Исправлен Back + Фокус на кнопке)
       ========================================================================== */

    function showModal(movie) {
        var title = esc(movie.title || movie.name || 'Фильм');
        var loading = $('<div class="sw-modal-content" style="text-align:center;padding:60px"><div style="font-size:2em;margin-bottom:15px">⏳</div><div style="color:#ccc">Анализируем...</div></div>');

        Lampa.Modal.open({
            title: 'Стоит ли смотреть: ' + title,
            html: loading,
            size: 'large',
            zIndex: 1000,
            onBack: function() {
                isRolling = false;
                Lampa.Controller.toggle('full');
            }
        });

        analyze(movie).then(function(a) {
            // Кнопка — первый .selector в scroll-mask для гарантированного фокуса
            var html = $(
                '<div class="sw-modal-content scroll-mask">' +
                    '<div class="sw-dice-section">' +
                        '<div class="sw-dice-btn selector" id="sw-dice-btn"><span style="font-size:1.5em">🎲</span> Бросить кости</div>' +
                        '<div class="sw-verdict" id="sw-verdict"></div>' +
                    '</div>' +
                    '<div class="sw-columns">' +
                        '<div class="sw-col"><div class="sw-title pros">Почему стоит ✓</div><ul class="sw-list">' + a.pros.map(function(p){return '<li>' + esc(p) + '</li>';}).join('') + '</ul></div>' +
                        '<div class="sw-col"><div class="sw-title cons">Почему не стоит ✗</div><ul class="sw-list">' + a.cons.map(function(c){return '<li>' + esc(c) + '</li>';}).join('') + '</ul></div>' +
                    '</div>' +
                    '<div class="sw-target-audience"><div class="sw-title target">Кому посмотреть? 🎯</div><div>' + esc(a.audience) + '</div></div>' +
                '</div>'
            );

            html.find('#sw-dice-btn').on('hover:enter click keydown', function(e) {
                if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                if (isRolling) return;
                isRolling = true;
                var btn = $(this), v = html.find('#sw-verdict');
                v.attr('style', '').attr('class', 'sw-verdict').text('');
                btn.addClass('shake');
                setTimeout(function() {
                    btn.removeClass('shake');
                    if (Math.random() > 0.5) {
                        v.text('Смотреть!').addClass('verdict-yes').css({color:'#85c25e',textShadow:'0 0 10px rgba(133,194,94,.3)'});
                    } else {
                        v.text('Не смотреть').addClass('verdict-no').css({color:'#d9534f',textShadow:'0 0 10px rgba(217,83,79,.3)'});
                    }
                    Lampa.Controller.collectionFocus(btn);
                    isRolling = false;
                }, 500);
            });

            Lampa.Modal.update(html);
            Lampa.Controller.toggle('modal');
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
        try {
            Lampa.Listener.follow('full', function(e) {
                if (e.type !== 'complite') return;
                try { addBtn(e.object.activity.render(), e.data.movie); } catch(err) { console.error('[SW]', err); }
            });
        } catch(err) {}
        try { initSettings(); } catch(err) {}
        try { injectCSS(); } catch(err) {}
        console.log('[ShouldWatch] v9.0 initialized.');
    }

    try {
        if (window.appready) startPlugin();
        else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') startPlugin(); });
    } catch(e) {}

})();
