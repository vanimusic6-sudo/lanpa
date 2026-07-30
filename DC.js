(function () {
    'use strict';

    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;

    var PLUGIN_ID = 'should_watch_plugin';
    var ICON = '<svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="8" stroke-linecap="square" fill="none"><path d="M20,55 L40,75 L80,25"/><path d="M25,25 L75,75" stroke-dasharray="4,4"/></g></svg>';
    var currentModalHtml = null;
    var isRolling = false;

    /* ==========================================================================
       НАСТРОЙКИ (по образцу Opinions & Reviews v2.3)
       ========================================================================== */

    function getSetting(key, def) {
        try {
            var fullKey = PLUGIN_ID + '_' + key;
            var val = Lampa.Storage.get(fullKey);
            if (val !== undefined && val !== null && val !== '') return val;
            var ns = Lampa.Storage.get(PLUGIN_ID, {});
            if (ns && ns[key] !== undefined && ns[key] !== '') return ns[key];
        } catch(e) {}
        return def;
    }

    function saveSetting(key, value) {
        try {
            Lampa.Storage.set(PLUGIN_ID + '_' + key, value);
            var ns = Lampa.Storage.get(PLUGIN_ID, {});
            ns[key] = value;
            Lampa.Storage.set(PLUGIN_ID, ns);
        } catch(e) {}
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
        return str ? str.toLowerCase().split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    }

    function initSettings() {
        if (!window.Lampa || !Lampa.SettingsApi || window.sw_settings_ready) return;
        window.sw_settings_ready = true;

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: 'Стоит ли смотреть?',
            icon: ICON
        });

        var params = [
            { name: 'bad_genres', type: 'input', title: 'Нелюбимые жанры', description: 'Через запятую: Ужасы, Документальный...', default: '' },
            { name: 'bad_actors', type: 'input', title: 'Нелюбимые актёры', description: 'Через запятую: Адам Сэндлер, Николас Кейдж...', default: '' },
            { name: 'bad_directors', type: 'input', title: 'Нелюбимые авторы', description: 'Режиссёры/сценаристы через запятую', default: '' },
            { name: 'min_rating', type: 'select', title: 'Мин. рейтинг', description: 'Порог для рекомендации "Смотреть"', values: {'0':'Любой','5':'5.0','6':'6.0','7':'7.0','8':'8.0'}, default: '6' }
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
            '.sw-modal-content{padding:15px;color:#fff;font-family:sans-serif;max-height:80vh;overflow:hidden}' +
            '.sw-columns{display:flex;justify-content:space-between;gap:20px;margin-bottom:25px}' +
            '.sw-col{flex:1;background:rgba(255,255,255,.05);padding:15px;border-radius:10px;max-height:35vh;overflow-y:auto;scroll-behavior:smooth}' +
            '.sw-col::-webkit-scrollbar{width:4px}' +
            '.sw-col::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:2px}' +
            '.sw-title{font-size:1.1em;font-weight:bold;margin-bottom:15px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:10px}' +
            '.sw-title.pros{color:#85c25e}.sw-title.cons{color:#d9534f}.sw-title.target{color:#e0e0e0}' +
            '.sw-list{margin:0;padding-left:20px;font-size:.95em;line-height:1.4;color:#ccc}' +
            '.sw-list li{margin-bottom:8px}' +
            '.sw-target-audience{margin-bottom:30px;background:rgba(255,255,255,.05);padding:15px;border-radius:10px}' +
            '.sw-dice-wrapper{text-align:center;margin-top:10px}' +
            '.sw-dice-btn{background:#eadecd;color:#1a1a1a;font-size:1.4em;font-weight:bold;padding:15px 30px;border-radius:30px;display:inline-flex;align-items:center;gap:15px;transition:transform .2s,background .2s;cursor:pointer;outline:none}' +
            '.sw-dice-btn.focus{background:#fff;transform:scale(1.05);box-shadow:0 0 15px rgba(255,255,255,.3)}' +
            '.sw-dice-btn.shake{animation:swShake .5s}' +
            '.sw-verdict{margin-top:15px;font-size:1.5em;font-weight:bold;min-height:35px;text-transform:uppercase}' +
            '@keyframes swShake{0%,100%{transform:translate(1px,-2px) rotate(-1deg)}10%,30%,50%,70%,90%{transform:translate(-1px,2px) rotate(1deg)}20%,40%,60%,80%{transform:translate(-3px,0) rotate(0deg)}}';
        document.head.appendChild(s);
    }

    /* ==========================================================================
       УТИЛИТЫ И CREDITS
       ========================================================================== */

    function esc(s) { return typeof s === 'string' ? $('<div>').text(s).html() : ''; }

    function loadCredits(movie) {
        if (movie.credits && (movie.credits.cast && movie.credits.cast.length || movie.credits.crew && movie.credits.crew.length)) {
            return Promise.resolve(movie.credits);
        }
        var id = movie.id || movie.tmdb_id;
        if (!id) return Promise.resolve(null);
        if (Lampa.TMDB && typeof Lampa.TMDB.credits === 'function') {
            return new Promise(function(resolve) {
                Lampa.TMDB.credits(id, function(data) {
                    resolve(data && !data.status_code ? data : null);
                }, function() { resolve(null); });
            });
        }
        return Promise.resolve(null);
    }

    // Экспорт внутренних переменных и функций для Части 2
    window._sw_internal = {
        PLUGIN_ID: PLUGIN_ID,
        ICON: ICON,
        currentModalHtml: currentModalHtml,
        isRolling: isRolling,
        getSettings: getSettings,
        parseBL: parseBL,
        esc: esc,
        loadCredits: loadCredits,
        initSettings: initSettings,
        injectCSS: injectCSS
    }
    // Подхватываем экспортированные данные из Части 1
    if (!window._sw_internal) return;
    var _sw = window._sw_internal;

    /* ==========================================================================
       АНАЛИЗАТОР (расширенный v7)
       ========================================================================== */

    function analyze(movie) {
        return _sw.loadCredits(movie).then(function(credits) {
            var cfg = _sw.getSettings();
            var blG = _sw.parseBL(cfg.bad_genres);
            var blA = _sw.parseBL(cfg.bad_actors);
            var blD = _sw.parseBL(cfg.bad_directors);
            var minR = cfg.min_rating;

            var r = parseFloat(movie.vote_average) || 0;
            var vc = parseInt(movie.vote_count) || 0;
            var genres = (movie.genres || []).map(function(g){return g.name;}).filter(Boolean);
            var ov = (movie.overview || '').trim();
            var rt = parseInt(movie.runtime) || 0;
            var lang = movie.original_language || '';
            var adult = !!movie.adult;
            var seq = !!movie.belongs_to_collection;
            var origTitle = movie.original_title || movie.original_name || '';
            var kpRating = parseFloat(movie.rating_kp) || 0;
            var imdbRating = parseFloat(movie.rating_imdb) || 0;

            // Качество
            var qualityStr = (movie.quality || movie.source_quality || '').toString().toUpperCase();
            var maxQuality = '';
            if (/2160|4K|UHD/.test(qualityStr)) maxQuality = '4K UHD';
            else if (/1080|FHD|FULLHD/.test(qualityStr)) maxQuality = 'Full HD 1080p';
            else if (/720|HD/.test(qualityStr)) maxQuality = 'HD 720p';
            else if (/WEB-DL|WEBRIP/i.test(qualityStr)) maxQuality = 'WEB-DL';
            else if (/BDRIP|BLURAY/i.test(qualityStr)) maxQuality = 'BluRay';
            else if (qualityStr) maxQuality = qualityStr;

            // Плохое качество (экранки)
            var isBadQuality = /CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT/i.test(qualityStr);

            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){return c.name;}).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){return c.job === 'Director';}).map(function(c){return c.name;}).filter(Boolean);
            var wrts = crew.filter(function(c){return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0;}).map(function(c){return c.name;}).filter(Boolean);

            var P = [], C = [];

            // --- ЧЁРНЫЕ СПИСКИ ---
            var mG = genres.filter(function(g){return blG.some(function(b){return g.toLowerCase().indexOf(b) >= 0;});});
            var mA = cast.filter(function(a){return blA.some(function(b){return a.toLowerCase().indexOf(b) >= 0;});});
            var mD = [].concat(dirs, wrts).filter(function(p){return blD.some(function(b){return p.toLowerCase().indexOf(b) >= 0;});});
            if (mG.length) C.push('⛔ Нелюбимый жанр: ' + mG.join(', '));
            if (mA.length) C.push('⛔ Нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '));
            if (mD.length) C.push('⛔ Нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '));

            // --- КАЧЕСТВО ---
            if (isBadQuality) C.push('📺 Низкое качество: ' + (qualityStr || 'CAM/TS') + ' — возможен плохой звук/картинка');
            if (maxQuality && !isBadQuality) P.push('🎬 Макс. качество: ' + maxQuality);

            // --- РЕКЛАМА / КАЗИНО / СТАВКИ ---
            var adKeywords = ['казино', 'casino', 'бетсити', 'betcity', '1xbet', 'винлайн', 'winline', 'фонбет', 'fonbet', 'ставка', 'ставки на спорт', 'букмекер', 'bookmaker', 'партнёр', 'реклама', 'промокод', 'promocode', 'спонсор'];
            var ovLower = ov.toLowerCase();
            var foundAds = adKeywords.filter(function(kw){return ovLower.indexOf(kw) >= 0;});
            if (foundAds.length) C.push('🎰 Возможна реклама: ' + foundAds.slice(0,3).join(', '));

            // --- ПЛОХОЙ СЮЖЕТ ПО МНЕНИЮ ЗРИТЕЛЕЙ ---
            var plotConsensus = false;
            if (r > 0 && r < 5 && vc >= 100) plotConsensus = true;
            if (kpRating > 0 && kpRating < 5 && imdbRating > 0 && imdbRating < 5) plotConsensus = true;
            var badPlotWords = ['скучный', 'предсказуемый', 'затянутый', 'нелогичный', 'дыры в сюжете', 'слабый сюжет', 'разочарование', 'boring', 'predictable', 'plot holes', 'weak story', 'disappointing'];
            var hasBadPlotWords = badPlotWords.some(function(w){return ovLower.indexOf(w) >= 0;});
            if (plotConsensus && hasBadPlotWords) C.push('👎 Плохой сюжет по мнению зрителей: низкие оценки + негативные отзывы');
            else if (plotConsensus) C.push('👎 Слабые оценки зрителей: возможный слабый сюжет');
            else if (hasBadPlotWords && vc >= 50) C.push('👎 В отзывах упоминаются проблемы с сюжетом');

            // --- РЕЙТИНГ + ГОЛОСА ---
            if (r > 0 && r < minR) C.push('📉 Рейтинг ' + r.toFixed(1) + ' ниже порога (' + minR + ')');
            if (vc < 30 && r > 0) C.push('❓ Всего ' + vc + ' оценок — недостоверно');
            if (vc < 10 && r > 0) C.push('⚠️ Менее 10 оценок — лотерея');
            if (r >= minR && vc >= 200) P.push('⭐ Надёжный рейтинг: ' + r.toFixed(1) + ' (' + vc + ' голосов)');
            else if (r >= minR && vc >= 50) P.push('⭐ Рейтинг ' + r.toFixed(1) + ' (' + vc + ' голосов)');
            else if (r >= minR && vc > 0) P.push('⭐ Рейтинг ' + r.toFixed(1) + ', мало голосов (' + vc + ')');
            if (r >= 8 && vc >= 500) P.push('🏆 Выбор зрителей: ' + r.toFixed(1) + ' из ' + vc);

            // --- СЮЖЕТ ---
            if (!ov) C.push('📭 Нет описания сюжета');
            else if (ov.length < 40) C.push('📝 Короткое описание (' + ov.length + ' симв.)');
            else if (ov.length > 300) P.push('📖 Развёрнутая аннотация');
            else if (ov.length > 100) P.push('📖 Есть описание сюжета');

            // --- ДЛИТЕЛЬНОСТЬ ---
            if (rt > 200) C.push('⏱ Эпик: ' + rt + ' мин.');
            else if (rt > 180) C.push('⏱ Очень длинный: ' + rt + ' мин.');
            else if (rt > 0 && rt <= 130) P.push('⏱ Комфортно: ' + rt + ' мин.');
            else if (rt > 0 && rt < 60) C.push('⏱ Короткометражка: ' + rt + ' мин.');

            // --- ЛЮДИ ---
            if (dirs.length && !mD.length) P.push('🎬 Режиссёр: ' + dirs[0]);
            if (wrts.length && !mD.length) P.push('✍️ Сценарист: ' + wrts[0]);
            if (cast.length > 0 && !mA.length) P.push('🎭 В ролях: ' + cast.slice(0,3).join(', '));

            // --- ЖАНРЫ / ПРОЧЕЕ ---
            if (genres.length && !mG.length) P.push('🎞 ' + genres.slice(0,2).join(', '));
            if (lang === 'ru') P.push('🇷🇺 Оригинальный русский язык');
            else if (lang === 'en') P.push('🌍 Оригинал на английском');
            if (adult) C.push('🔞 Контент 18+');
            if (seq) P.push('🔗 Часть франшизы');
            if (origTitle && origTitle !== movie.title && origTitle !== movie.name) P.push('🏷 Ориг.: ' + origTitle);

            if (!P.length) P.push('ℹ️ Недостаточно метаданных');
            if (!C.length) C.push('✅ Противопоказаний не выявлено');

            // --- КОМУ СМОТРЕТЬ (комбинаторика) ---
            var aud = [];
            if (genres.length && !mG.length && cast.length && !mA.length) aud.push('тем, кому нравится ' + genres[0] + ' с ' + cast[0]);
            else if (genres.length && !mG.length) aud.push('поклонникам «' + genres[0] + '»');
            if (dirs.length && !mD.length && r >= 7) aud.push('ценителям стиля ' + dirs[0]);
            else if (dirs.length && !mD.length) aud.push('следящим за ' + dirs[0]);
            if (r >= 8 && vc >= 500) aud.push('доверяющим массовому выбору');
            else if (r >= 7 && vc >= 100) aud.push('ориентирующимся на рейтинг');
            if (maxQuality && !isBadQuality) aud.push('любителям качественного изображения');
            if (rt > 0 && rt <= 100) aud.push('у кого мало времени');
            if (lang === 'ru') aud.push('предпочитающим русское кино');
            if (seq) aud.push('фанатам франшизы');

            var audience;
            if (aud.length >= 2) audience = 'Идеально подойдёт ' + aud.slice(0,3).join('; ') + '.';
            else if (aud.length === 1) audience = 'Стоит попробовать ' + aud[0] + '.';
            else audience = 'Подходит для просмотра без ожиданий.';

            return { pros: P, cons: C, audience: audience };
        });
    }

    /* ==========================================================================
       КОНТРОЛЛЕР С ПРОКРУТКОЙ
       ========================================================================== */

    function registerController() {
        Lampa.Controller.add('should_watch_modal', {
            toggle: function() {
                if (_sw.currentModalHtml) {
                    Lampa.Controller.collectionSet(_sw.currentModalHtml);
                    var b = _sw.currentModalHtml.find('#sw-dice-btn');
                    if (b.length) Lampa.Controller.collectionFocus(b);
                    else Lampa.Controller.collectionFocus(false, _sw.currentModalHtml);
                }
            },
            up: function() {
                var col = _sw.currentModalHtml && _sw.currentModalHtml.find('.sw-col-active');
                if (col && col.length && col.scrollTop() > 0) col.animate({scrollTop: col.scrollTop() - 80}, 150);
            },
            down: function() {
                var col = _sw.currentModalHtml && _sw.currentModalHtml.find('.sw-col-active');
                if (col && col.length) {
                    var max = col[0].scrollHeight - col.outerHeight();
                    if (col.scrollTop() < max) col.animate({scrollTop: col.scrollTop() + 80}, 150);
                }
            },
            left: function() {
                if (!_sw.currentModalHtml) return;
                _sw.currentModalHtml.find('.sw-col:last').addClass('sw-col-active');
                _sw.currentModalHtml.find('.sw-col:first').removeClass('sw-col-active');
            },
            right: function() {
                if (!_sw.currentModalHtml) return;
                _sw.currentModalHtml.find('.sw-col:first').addClass('sw-col-active');
                _sw.currentModalHtml.find('.sw-col:last').removeClass('sw-col-active');
            },
            back: function() {
                _sw.isRolling = false;
                Lampa.Modal.close();
                Lampa.Controller.toggle('full');
            }
        });
    }

    /* ==========================================================================
       МОДАЛКА
       ========================================================================== */

    function showModal(movie) {
        var title = _sw.esc(movie.title || movie.name || 'Фильм');
        var loading = $('<div class="sw-modal-content" style="text-align:center;padding:40px"><div style="font-size:2em;margin-bottom:15px">⏳</div><div style="color:#ccc">Анализируем...</div></div>');

        Lampa.Modal.open({
            title: 'Стоит ли смотреть: ' + title,
            html: loading,
            size: 'medium',
            zIndex: 1000,
            onBack: function() { _sw.currentModalHtml = null; _sw.isRolling = false; Lampa.Controller.toggle('full'); }
        });

        analyze(movie).then(function(a) {
            var html = $(
                '<div class="sw-modal-content">' +
                    '<div class="sw-columns">' +
                        '<div class="sw-col sw-col-active"><div class="sw-title pros">Почему стоит ✓</div><ul class="sw-list">' + a.pros.map(function(p){return '<li>' + _sw.esc(p) + '</li>';}).join('') + '</ul></div>' +
                        '<div class="sw-col"><div class="sw-title cons">Почему не стоит ✗</div><ul class="sw-list">' + a.cons.map(function(c){return '<li>' + _sw.esc(c) + '</li>';}).join('') + '</ul></div>' +
                    '</div>' +
                    '<div class="sw-target-audience"><div class="sw-title target">Кому посмотреть? 🎯</div><div style="color:#ccc;line-height:1.5">' + _sw.esc(a.audience) + '</div></div>' +
                    '<div class="sw-dice-wrapper">' +
                        '<div class="sw-dice-btn selector" id="sw-dice-btn"><span style="font-size:1.5em">🎲</span> Бросить кости</div>' +
                        '<div class="sw-verdict" id="sw-verdict"></div>' +
                    '</div>' +
                '</div>'
            );

            _sw.currentModalHtml = html;

            html.find('#sw-dice-btn').on('hover:enter click keydown', function(e) {
                if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                if (_sw.isRolling) return;
                _sw.isRolling = true;

                var btn = $(this);
                var v = html.find('#sw-verdict');

                v.attr('style', '').attr('class', 'sw-verdict').text('');
                btn.addClass('shake');

                setTimeout(function() {
                    btn.removeClass('shake');
                    var yes = Math.random() > 0.5;
                    if (yes) {
                        v.text('Смотреть!').attr('class', 'sw-verdict verdict-yes')
                         .attr('style', 'color:#85c25e!important;text-shadow:0 0 10px rgba(133,194,94,.3)');
                    } else {
                        v.text('Не смотреть').attr('class', 'sw-verdict verdict-no')
                         .attr('style', 'color:#d9534f!important;text-shadow:0 0 10px rgba(217,83,79,.3)');
                    }
                    Lampa.Controller.collectionFocus(btn);
                    _sw.isRolling = false;
                }, 500);
            });

            Lampa.Modal.update(html);
            Lampa.Controller.toggle('should_watch_modal');
        });
    }

    /* ==========================================================================
       ИНЪЕКЦИЯ КНОПКИ
       ========================================================================== */

    function addBtn(el, movie) {
        if (!el || !el.length || el.find('.sw-custom-button').length) return;
        var btn = $('<div class="full-start__button selector sw-custom-button" data-type="should_watch"><div class="full-start__icon">' + _sw.ICON + '</div><span>Стоит ли?</span></div>');
        btn.on('hover:enter', function() { if (movie) showModal(movie); });
        var anchor = el.find('.view--torrent,.view--online,.view--trailer').last();
        if (anchor.length) anchor.after(btn);
        else {
            var fb = el.find('.full-start__buttons,.full-start-new__buttons,.full-card__buttons');
            if (fb.length) fb.append(btn);
        }
    }

    /* ==========================================================================
       ЗАПУСК ПЛАГИНА (по образцу appready)
       ========================================================================== */

    function startPlugin() {
        try {
            Lampa.Listener.follow('full', function(e) {
                if (e.type !== 'complite') return;
                try {
                    var render = e.object.activity.render();
                    addBtn(render, e.data.movie);
                } catch(err) { console.error('[SW] Inject error:', err); }
            });
        } catch(err) {}

        try { _sw.initSettings(); } catch(err) {}
        try { _sw.injectCSS(); } catch(err) {}
        try { registerController(); } catch(err) {}

        console.log('[ShouldWatch] v7.0 initialized.');
    }

    try {
        if (window.appready) startPlugin();
        else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') startPlugin(); });
    } catch(e) {}

})();
