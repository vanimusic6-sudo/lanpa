(function () {
    'use strict';
    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;

    var PLUGIN_ID = 'should_watch_plugin';
    var ICON = '<svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="8" stroke-linecap="square" fill="none"><path d="M20,55 L40,75 L80,25"/><path d="M25,25 L75,75" stroke-dasharray="4,4"/></g></svg>';

    // --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
    window._sw_currentModalHtml = null;
    window._sw_prevController = null;
    window._sw_rolling = false;

    // --- НАСТРОЙКИ ---
    function getSetting(key, def) {
        try { return Lampa.Storage.get(PLUGIN_ID + '_' + key) || def; } catch(e) { return def; }
    }
    function saveSetting(key, val) {
        try { Lampa.Storage.set(PLUGIN_ID + '_' + key, val); } catch(e) {}
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

    // --- СТИЛИ ---
    function injectCSS() {
        if (document.getElementById('sw-plugin-styles')) return;
        var s = document.createElement('style');
        s.id = 'sw-plugin-styles';
        s.innerHTML =
            '.sw-modal-content{padding:20px;color:#fff;font-family:sans-serif;max-height:72vh;overflow-y:auto}' +
            '.sw-dice-section{text-align:center;margin-bottom:30px;padding:20px;background:rgba(255,255,255,.03);border-radius:12px}' +
            '.sw-dice-btn{background:#eadecd;color:#1a1a1a;font-size:1.4em;font-weight:bold;padding:15px 40px;border-radius:30px;display:inline-flex;align-items:center;gap:15px;cursor:pointer;outline:none;border:3px solid transparent}' +
            '.sw-dice-btn.focus{background:#fff;transform:scale(1.05);box-shadow:0 0 0 3px #fff,0 0 20px rgba(255,255,255,.4);border-color:#fff}' +
            '.sw-verdict{margin-top:15px;font-size:1.6em;font-weight:bold;min-height:40px;text-transform:uppercase}' +
            '.sw-verdict.verdict-yes{color:#85c25e!important;text-shadow:0 0 10px rgba(133,194,94,.3)}' +
            '.sw-verdict.verdict-no{color:#d9534f!important;text-shadow:0 0 10px rgba(217,83,79,.3)}' +
            '.sw-columns{display:flex;justify-content:space-between;gap:20px;margin-bottom:25px}' +
            '.sw-col{flex:1;background:rgba(255,255,255,.05);padding:15px;border-radius:10px}' +
            '.sw-title{font-size:1.1em;font-weight:bold;margin-bottom:15px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:10px}' +
            '.sw-title.pros{color:#85c25e}.sw-title.cons{color:#d9534f}.sw-title.target{color:#e0e0e0}' +
            '.sw-list{margin:0;padding-left:20px;font-size:.95em;line-height:1.5;color:#ccc}' +
            '.sw-list li{margin-bottom:10px}';
        document.head.appendChild(s);
    }

    // --- УТИЛИТЫ ---
    function esc(s) { return typeof s === 'string' ? $('<div>').text(s).html() : ''; }
    function parseBL(str) { return str ? str.split(',').map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean) : []; }
    function hasGenre(genres, re) { return genres.some(function(g){ return re.test(g); }); }
    function inText(text, re) { return re.test((text || '').toLowerCase()); }

    // --- АНАЛИЗ (чистая логика без сетей, без Promise, без ИИ) ---
    function analyze(movie) {
        var cfg = {
            bad_genres: parseBL(getSetting('bad_genres', '')),
            bad_actors: parseBL(getSetting('bad_actors', '')),
            bad_directors: parseBL(getSetting('bad_directors', '')),
            min_rating: parseFloat(getSetting('min_rating', '6')) || 6
        };

        var q = (movie.quality || movie.source_quality || '').toString();
        var rating = parseFloat(movie.vote_average) || 0;
        var votes = parseInt(movie.vote_count) || 0;
        var runtime = parseInt(movie.runtime) || 0;
        var genres = (movie.genres || []).map(function(g){ return g.name; }).filter(Boolean);
        var ov = (movie.overview || '').trim();
        var cast = (movie.credits && movie.credits.cast) ? movie.credits.cast.slice(0,15).map(function(c){ return c.name; }) : [];
        var dirs = (movie.credits && movie.credits.crew) ? movie.credits.crew.filter(function(c){ return c.job === 'Director'; }).map(function(c){ return c.name; }) : [];
        var wrts = (movie.credits && movie.credits.crew) ? movie.credits.crew.filter(function(c){ return ['Writer','Screenplay'].includes(c.job); }).map(function(c){ return c.name; }) : [];

        // --- Плюсы ---
        var pros = [];
        if (rating >= cfg.min_rating && votes >= 100) pros.push('⭐ высокий рейтинг (' + rating.toFixed(1) + ')');
        if (hasGenre(genres, /action|боевик/i)) pros.push('💥 впечатляющие экшен-сцены');
        if (hasGenre(genres, /family|animation|детск/i) && rating >= 6 && !inText(ov, /насилие|нагота|наркотики/)) pros.push('👪 семейный просмотр');
        if (hasGenre(genres, /documentary|документ/i)) pros.push('🦫 полезная информация');
        if (q && !/CAM|TS|HDCAM|SCR/i.test(q)) pros.push('🎥 отличное качество видео (' + q + ')');
        if (runtime > 0 && runtime <= 130) pros.push('🕐 комфортный хронометраж (' + runtime + ' мин.)');

        // --- Минусы ---
        var cons = [];
        var mG, mA, mD;
        mG = genres.filter(function(g){ var gl=g.toLowerCase(); return cfg.bad_genres.some(function(b){ return gl.indexOf(b) >= 0; }); });
        mA = cast.filter(function(a){ var al=a.toLowerCase(); return cfg.bad_actors.some(function(b){ return al.indexOf(b) >= 0; }); });
        mD = [].concat(dirs, wrts).filter(function(p){ var pl=p.toLowerCase(); return cfg.bad_directors.some(function(b){ return pl.indexOf(b) >= 0; }); });
        if (mG.length) cons.push('⛔ Нелюбимый жанр: ' + mG.join(', '));
        if (mA.length) cons.push('⛔ Нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '));
        if (mD.length) cons.push('⛔ Нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '));

        if (inText(ov, /наркотики|метамфетамин|варк/)) cons.push('💉 употребление наркотиков');
        if (inText(ov, /насилие|жестокость|убийство/)) cons.push('🔪 жестокие сцены');
        if (inText(ov, /курение|алкоголь|пьян/)) cons.push('🚬 курение или употребление алкоголя');
        if (inText(ov, /откровенные|нагота/)) cons.push('💋 откровенные сцены');
        if (runtime > 180) cons.push('⌛ высокий хронометраж (' + runtime + ' мин.)');
        if (/CAM|TS|HDCAM|SCR/i.test(q)) cons.push('📺 низкое качество видео');

        if (!pros.length) pros.push('ℹ️ Недостаточно данных');
        if (!cons.length) cons.push('✅ Противопоказаний не выявлено');

        // --- Кому посмотреть ---
        var audience = 'Любителям кино.';
        var tags = [];
        if (hasGenre(genres, /action|боевик/i)) tags.push('экшена');
        if (hasGenre(genres, /drama|драма/i)) tags.push('драмы');
        if (hasGenre(genres, /comedy|комед/i)) tags.push('комедии');
        if (hasGenre(genres, /sci-fi|фантастик/i)) tags.push('фантастики');
        if (q && !/CAM|TS/i.test(q)) tags.push('качества картинки');
        if (tags.length) audience = 'Любителям ' + tags.join(', ') + '.';

        return { pros: pros, cons: cons, audience: audience };
    }

    // --- КОНТРОЛЛЕР ---
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
            up: function() {},
            down: function() {},
            left: function() {},
            right: function() {},
            back: function() {
                window._sw_rolling = false;
                window._sw_currentModalHtml = null;
                try { Lampa.Modal.close(); } catch(e) {}
                try { Lampa.Controller.toggle('full'); } catch(e) {}
            }
        });
    }

    // --- МОДАЛКА ---
    function showModal(movie) {
        var title = esc(movie.title || movie.name || 'Фильм');
        var a = analyze(movie);

        var html = $(
            '<div class="sw-modal-content">' +
                '<div class="sw-dice-section">' +
                    '<div class="sw-dice-btn selector" id="sw-dice-btn"><span style="font-size:1.5em">🎲</span> Бросить кости' +
                    '</div>' +
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
            if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
            if (window._sw_rolling) return;
            window._sw_rolling = true;
            var btn = $(this), v = html.find('#sw-verdict');
            v.text('').removeClass('verdict-yes verdict-no');
            btn.addClass('shake');
            setTimeout(function() {
                btn.removeClass('shake');
                if (Math.random() > 0.5) {
                    v.text('Смотреть!').addClass('verdict-yes');
                } else {
                    v.text('Не смотреть').addClass('verdict-no');
                }
                Lampa.Controller.collectionFocus(btn);
                window._sw_rolling = false;
            }, 500);
        });

        Lampa.Modal.open({
            title: 'Стоит ли смотреть: ' + title,
            html: html,
            size: 'large',
            zIndex: 1000,
            onBack: function() {
                window._sw_rolling = false;
                window._sw_currentModalHtml = null;
                Lampa.Modal.close();
                Lampa.Controller.toggle('full');
            }
        });
        Lampa.Controller.toggle('should_watch_modal');
    }

    // --- ИНЪЕКЦИЯ КНОПКИ ---
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

    // --- ЗАПУСК ---
    function startPlugin() {
        try { registerController(); } catch(e) {}
        try {
            Lampa.Listener.follow('full', function(e) {
                if (e.type !== 'complite') return;
                try { addBtn(e.object.activity.render(), e.data.movie); } catch(err) { console.error('[SW]', err); }
            });
        } catch(e) {}
        try { initSettings(); } catch(e) {}
        try { injectCSS(); } catch(e) {}
        console.log('[ShouldWatch] v18.0 — работает на Android TV без интернета.');
    }

    try {
        if (window.appready) startPlugin();
        else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') startPlugin(); });
    } catch(e) {}

})();
