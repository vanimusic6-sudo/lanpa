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
        try {
            Lampa.Storage.set(PLUGIN_ID + '_' + key, value);
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
        if (!str || typeof str !== 'string') return [];
        return str.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
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
       СТИЛИ (TV-адаптация: фокус, скролл, безопасная зона)
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
                Lampa.TMDB.credits(id, function(data) {
                    resolve(data && !data.status_code ? data : null);
                }, function() { resolve(null); });
            });
        }
        return Promise.resolve(null);
    }

    window._sw_internal = {
        PLUGIN_ID: PLUGIN_ID,
        ICON: ICON,
        getSettings: getSettings,
        parseBL: parseBL,
        esc: esc,
        loadCredits: loadCredits,
        initSettings: initSettings,
        injectCSS: injectCSS
    } if (!window._sw_internal) return;
    var _sw = window._sw_internal;
    var isRolling = false;

    /* ==========================================================================
       АНАЛИЗАТОР v8 (живые тексты + исправленные черные списки)
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

            var qualityStr = (movie.quality || movie.source_quality || '').toString().toUpperCase();
            var maxQuality = '';
            if (/2160|4K|UHD/.test(qualityStr)) maxQuality = '4K UHD';
            else if (/1080|FHD|FULLHD/.test(qualityStr)) maxQuality = 'Full HD 1080p';
            else if (/720|HD/.test(qualityStr)) maxQuality = 'HD 720p';
            else if (/WEB-DL|WEBRIP/i.test(qualityStr)) maxQuality = 'WEB-DL';
            else if (/BDRIP|BLURAY/i.test(qualityStr)) maxQuality = 'BluRay';
            else if (qualityStr) maxQuality = qualityStr;
            var isBadQuality = /CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT/i.test(qualityStr);

            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){return c.name;}).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){return c.job === 'Director';}).map(function(c){return c.name;}).filter(Boolean);
            var wrts = crew.filter(function(c){return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0;}).map(function(c){return c.name;}).filter(Boolean);

            var P = [], C = [];

            // Чёрные списки (исправленный поиск)
            var mG = genres.filter(function(g){ var gl = g.toLowerCase(); return blG.some(function(b){return gl.indexOf(b) >= 0;}); });
            var mA = cast.filter(function(a){ var al = a.toLowerCase(); return blA.some(function(b){return al.indexOf(b) >= 0;}); });
            var mD = [].concat(dirs, wrts).filter(function(p){ var pl = p.toLowerCase(); return blD.some(function(b){return pl.indexOf(b) >= 0;}); });
            if (mG.length) C.push('⛔ Нелюбимый жанр: ' + mG.join(', '));
            if (mA.length) C.push('⛔ Нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '));
            if (mD.length) C.push('⛔ Нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '));

            if (isBadQuality) C.push('📺 Низкое качество: ' + (qualityStr || 'CAM/TS'));
            if (maxQuality && !isBadQuality) P.push('🎬 Макс. качество: ' + maxQuality);

            var adKeywords = ['казино','casino','бетсити','betcity','1xbet','винлайн','winline','фонбет','fonbet','ставка','ставки на спорт','букмекер','bookmaker','промокод','promocode','спонсор'];
            var ovLower = ov.toLowerCase();
            var fAds = adKeywords.filter(function(kw){return ovLower.indexOf(kw) >= 0;});
            if (fAds.length) C.push('🎰 Возможна реклама: ' + fAds.slice(0,3).join(', '));

            var plotBad = (r > 0 && r < 5 && vc >= 100) || (kpRating > 0 && kpRating < 5 && imdbRating > 0 && imdbRating < 5);
            var badWords = ['скучный','предсказуемый','затянутый','нелогичный','дыры в сюжете','слабый сюжет','boring','predictable','plot holes'];
            var hasBadW = badWords.some(function(w){return ovLower.indexOf(w) >= 0;});
            if (plotBad && hasBadW) C.push('👎 Плохой сюжет по мнению зрителей');
            else if (plotBad) C.push('👎 Слабые оценки зрителей');

            if (r > 0 && r < minR) C.push('📉 Рейтинг ' + r.toFixed(1) + ' ниже порога (' + minR + ')');
            if (vc < 30 && r > 0) C.push('❓ Всего ' + vc + ' оценок');
            if (r >= minR && vc >= 200) P.push('⭐ Надёжный рейтинг: ' + r.toFixed(1) + ' (' + vc + ')');
            else if (r >= minR && vc >= 50) P.push('⭐ Рейтинг ' + r.toFixed(1) + ' (' + vc + ')');
            if (r >= 8 && vc >= 500) P.push('🏆 Выбор зрителей: ' + r.toFixed(1));
            if (!ov) C.push('📭 Нет описания сюжета');
            else if (ov.length < 40) C.push('📝 Короткое описание');
            else if (ov.length > 300) P.push('📖 Развёрнутая аннотация');
            if (rt > 200) C.push('⏱ Эпик: ' + rt + ' мин.');
            else if (rt > 0 && rt <= 130) P.push('⏱ Комфортно: ' + rt + ' мин.');
            if (dirs.length && !mD.length) P.push('🎬 Режиссёр: ' + dirs[0]);
            if (wrts.length && !mD.length) P.push('✍️ Сценарист: ' + wrts[0]);
            if (cast.length > 0 && !mA.length) P.push('🎭 В ролях: ' + cast.slice(0,3).join(', '));
            if (genres.length && !mG.length) P.push('🎞 ' + genres.slice(0,2).join(', '));
            if (lang === 'ru') P.push('🇷🇺 Русский язык');
            if (adult) C.push('🔞 Контент 18+');
            if (seq) P.push('🔗 Часть франшизы');
            if (origTitle && origTitle !== movie.title && origTitle !== movie.name) P.push('🏷 Ориг.: ' + origTitle);
            if (!P.length) P.push('ℹ️ Недостаточно метаданных');
            if (!C.length) C.push('✅ Противопоказаний не выявлено');

            // --- ЖИВАЯ РЕКОМЕНДАЦИЯ (не шаблон) ---
            var parts = [];
            if (genres.length && !mG.length) {
                if (cast.length && !mA.length && dirs.length && !mD.length) {
                    parts.push(genres[0] + ' от режиссёра ' + dirs[0] + ' с участием ' + cast[0]);
                } else if (cast.length && !mA.length) {
                    parts.push(genres[0] + ', где играет ' + cast[0]);
                } else if (dirs.length && !mD.length) {
                    parts.push(genres[0] + ' в стиле ' + dirs[0]);
                } else {
                    parts.push(genres[0]);
                }
            }
            if (r >= 7.5 && vc >= 200) parts.push('высокие оценки ' + vc + ' зрителей подтверждают качество');
            else if (r >= minR && vc >= 50) parts.push('рейтинг ' + r.toFixed(1) + ' выглядит убедительно');
            if (maxQuality && !isBadQuality) parts.push('доступно в ' + maxQuality);
            if (rt > 0 && rt <= 100) parts.push('хватит на вечер без усталости');
            else if (rt > 150) parts.push('потребуется свободное время (' + rt + ' мин.)');
            if (seq) parts.push('продолжение известной истории');
            if (lang === 'ru') parts.push('родной язык оригинала');

            var audience;
            if (parts.length >= 3) {
                audience = 'Этот фильм может зацепить тех, кто ищет ' + parts[0] + '. ' + parts[1].charAt(0).toUpperCase() + parts[1].slice(1) + ', а ' + parts.slice(2).join('; ') + '.';
            } else if (parts.length === 2) {
                audience = 'Подойдёт тем, кому интересен ' + parts[0] + ' — ' + parts[1] + '.';
            } else if (parts.length === 1) {
                audience = 'Может понравиться, если вам близок ' + parts[0] + '.';
            } else {
                audience = 'Нет явных причин ни за, ни против — можно рискнуть.';
            }

            return { pros: P, cons: C, audience: audience };
        });
    }

    /* ==========================================================================
       МОДАЛКА (TV-канон: нативный скролл, кнопка наверху)
       ========================================================================== */

    function showModal(movie) {
        var title = _sw.esc(movie.title || movie.name || 'Фильм');
        var loading = $('<div class="sw-modal-content" style="text-align:center;padding:60px"><div style="font-size:2em;margin-bottom:15px">⏳</div><div style="color:#ccc">Анализируем...</div></div>');

        Lampa.Modal.open({
            title: 'Стоит ли смотреть: ' + title,
            html: loading,
            size: 'large',
            zIndex: 1000
        });

        analyze(movie).then(function(a) {
            // Кнопка и вердикт НАВЕРХУ — всегда в безопасной зоне TV
            var html = $(
                '<div class="sw-modal-content scroll-mask">' +
                    '<div class="sw-dice-section">' +
                        '<div class="sw-dice-btn selector" id="sw-dice-btn"><span style="font-size:1.5em">🎲</span> Бросить кости</div>' +
                        '<div class="sw-verdict" id="sw-verdict"></div>' +
                    '</div>' +
                    '<div class="sw-columns">' +
                        '<div class="sw-col"><div class="sw-title pros">Почему стоит ✓</div><ul class="sw-list">' + a.pros.map(function(p){return '<li>' + _sw.esc(p) + '</li>';}).join('') + '</ul></div>' +
                        '<div class="sw-col"><div class="sw-title cons">Почему не стоит ✗</div><ul class="sw-list">' + a.cons.map(function(c){return '<li>' + _sw.esc(c) + '</li>';}).join('') + '</ul></div>' +
                    '</div>' +
                    '<div class="sw-target-audience"><div class="sw-title target">Кому посмотреть? 🎯</div><div>' + _sw.esc(a.audience) + '</div></div>' +
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

            // Нативный контроллер модалки Lampa = правильный скролл + фокус
            Lampa.Controller.toggle('modal');
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
       ЗАПУСК
       ========================================================================== */

    function startPlugin() {
        try {
            Lampa.Listener.follow('full', function(e) {
                if (e.type !== 'complite') return;
                try { addBtn(e.object.activity.render(), e.data.movie); } catch(err) { console.error('[SW]', err); }
            });
        } catch(err) {}
        try { _sw.initSettings(); } catch(err) {}
        try { _sw.injectCSS(); } catch(err) {}
        console.log('[ShouldWatch] v8.0 TV-adapted initialized.');
    }

    try {
        if (window.appready) startPlugin();
        else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') startPlugin(); });
    } catch(e) {}

})();
