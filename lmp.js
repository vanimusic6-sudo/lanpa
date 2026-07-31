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
    window._sw_focusIdx = 0;
    window._sw_controllerRegistered = false;
    var _metaCache = {};

    /* ===== НАСТРОЙКИ ===== */
    function getSetting(k, d) {
        try { var v = Lampa.Storage.get(PLUGIN_ID + '_' + k); if (v !== undefined && v !== null && v !== '') return v; } catch(e) {}
        return d;
    }
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
                    field: { name: p.title, description: p.description },
                    onChange: function(val) { saveSetting(p.name, val); }
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
                '.sw-modal-content{padding:20px 22px 60px;color:#fff;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;min-height:80vh;overflow-y:auto;-webkit-overflow-scrolling:touch}' +
                '.sw-modal-content::-webkit-scrollbar{width:5px}.sw-modal-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,.22);border-radius:3px}' +
                '.sw-body{animation:swFade .35s ease}' +
                '.sw-focusable{outline:none}' +
                '.sw-focusable.focus{box-shadow:0 0 0 3px rgba(255,255,255,.92),0 0 24px rgba(255,255,255,.22);transition:box-shadow .15s ease}' +
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
                '.sw-columns{display:flex;justify-content:space-between;gap:18px;margin-bottom:20px}' +
                '.sw-col{flex:1;background:rgba(255,255,255,.04);padding:15px 17px;border-radius:12px;border:1px solid rgba(255,255,255,.06);transition:transform .2s ease,border-color .2s ease,background .2s ease,box-shadow .15s ease}' +
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
                '@media(max-width:640px){.sw-columns{flex-direction:column}.sw-verdict-word{font-size:2.2em}}';
            document.head.appendChild(s);
        } catch(e) { console.error('[SW] injectCSS:', e); }
    }

    /* ===== УТИЛИТЫ ===== */
    function esc(s) { return typeof s === 'string' ? $('<div>').text(s).html() : ''; }
    function hasGenre(g, re) { return g.some(function(x){ return re.test(x); }); }
    function inText(s, re) { return re.test((s || '').toLowerCase()); }
    function inAnyText(texts, re) { return texts.some(function(s){ return inText(s, re); }); }
    function mediaType(m) { return (m && m.name && !m.title) ? 'tv' : 'movie'; }

    /* ===== БЛОЧНАЯ НАВИГАЦИЯ ===== */
    function swSetFocus(i) {
        try {
            var h = window._sw_currentModalHtml; if (!h || !h.length) return;
            var blocks = h.find('.sw-focusable'); if (!blocks.length) return;
            if (i < 0) i = 0; if (i >= blocks.length) i = blocks.length - 1;
            window._sw_focusIdx = i;
            blocks.removeClass('focus');
            var el = blocks.eq(i);
            el.addClass('focus');
            try { el[0].focus({ preventScroll: true }); } catch(e) { try { el[0].focus(); } catch(_) {} }
            try { el[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) {}
            setTimeout(function() {
                try {
                    var container = h[0];
                    var elTop = el[0].offsetTop;
                    var elHeight = el[0].offsetHeight;
                    var containerHeight = container.clientHeight;
                    var currentScroll = container.scrollTop;
                    if (elTop < currentScroll + 20) container.scrollTop = elTop - 20;
                    else if (elTop + elHeight > currentScroll + containerHeight - 20) container.scrollTop = elTop + elHeight - containerHeight + 20;
                } catch(err) {}
            }, 100);
            try { Lampa.Controller.collectionFocus(el); } catch(e) {}
        } catch(e) { console.error('[SW] setFocus:', e); }
    }

    /* ===== ЗАГРУЗКА ДАННЫХ С ТАЙМАУТОМ ===== */
    function loadCredits(movie) {
        try {
            if (movie.credits && ((movie.credits.cast && movie.credits.cast.length) || (movie.credits.crew && movie.credits.crew.length))) {
                return Promise.resolve(movie.credits);
            }
            var id = movie.id || movie.tmdb_id; if (!id) return Promise.resolve(null);
            if (Lampa.TMDB && typeof Lampa.TMDB.credits === 'function') {
                return new Promise(function(res) {
                    var timeout = setTimeout(function() { res(null); }, 5000);
                    Lampa.TMDB.credits(id, function(d) {
                        clearTimeout(timeout);
                        res(d && !d.status_code ? d : null);
                    }, function() {
                        clearTimeout(timeout);
                        res(null);
                    });
                });
            }
        } catch(e) { console.error('[SW] loadCredits:', e); }
        return Promise.resolve(null);
    }

    function tmdbKey() { try { if (Lampa.TMDB && Lampa.TMDB.key) return Lampa.TMDB.key; } catch(e) {} return '4ef0d7355d9ffb5151e987764708ce96'; }

    function tmdbGet(path) {
        return new Promise(function(res) {
            try {
                if (typeof fetch === 'undefined') return res(null);
                var sep = path.indexOf('?') >= 0 ? '&' : '?';
                var url = 'https://api.themoviedb.org/3' + path + sep + 'api_key=' + tmdbKey();
                
                // Таймаут 5 секунд через AbortController
                var controller = null;
                var timeout = null;
                if (typeof AbortController !== 'undefined') {
                    controller = new AbortController();
                    timeout = setTimeout(function() { controller.abort(); }, 5000);
                }
                
                fetch(url, controller ? { signal: controller.signal } : {})
                    .then(function(r) {
                        if (timeout) clearTimeout(timeout);
                        return r.json();
                    })
                    .then(function(d) { res(d && d.status_code ? null : d); })
                    .catch(function() {
                        if (timeout) clearTimeout(timeout);
                        res(null);
                    });
            } catch(e) { res(null); }
        });
    }

    function mapUSRating(s) { return { 'G':0, 'PG':7, 'PG-13':13, 'R':16, 'NC-17':17, 'TV-MA':17, 'TV-14':14, 'MA':17 }[(s || '').toUpperCase()] || null; }

    function loadMeta(movie) {
        var id = movie.id || movie.tmdb_id; if (!id) return Promise.resolve({ kw: [], age: null, reviews: [], hasTrailer: false, enOv: '' });
        if (_metaCache[id]) return Promise.resolve(_metaCache[id]);
        var type = mediaType(movie);
        var ratingPath = type === 'tv' ? '/' + type + '/' + id + '/content_ratings' : '/' + type + '/' + id + '/release_dates';

        return Promise.all([
            tmdbGet('/' + type + '/' + id + '/keywords'),
            tmdbGet(ratingPath),
            tmdbGet('/' + type + '/' + id + '/reviews'),
            tmdbGet('/' + type + '/' + id + '/videos'),
            tmdbGet('/' + type + '/' + id + '?language=en-US')
        ]).then(function(arr) {
            var kw = [];
            if (arr[0]) (arr[0].keywords || arr[0].results || []).forEach(function(k){ if (k && k.name) kw.push(k.name.toLowerCase()); });

            var age = null;
            if (arr[1] && arr[1].results) {
                if (type === 'tv') {
                    var ruTv = arr[1].results.find(function(x){ return x.iso_3166_1 === 'RU'; });
                    var usTv = arr[1].results.find(function(x){ return x.iso_3166_1 === 'US'; });
                    if (ruTv && ruTv.rating) { var n = parseInt(ruTv.rating); if (!isNaN(n)) age = n; }
                    if (age === null && usTv && usTv.rating) age = mapUSRating(usTv.rating);
                } else {
                    var ruMov = arr[1].results.find(function(x){ return x.iso_3166_1 === 'RU'; });
                    var usMov = arr[1].results.find(function(x){ return x.iso_3166_1 === 'US'; });
                    if (ruMov && ruMov.release_dates && ruMov.release_dates.length) {
                        for (var i = 0; i < ruMov.release_dates.length; i++) {
                            var cert = ruMov.release_dates[i].certification;
                            if (cert) { var nRu = parseInt(cert); if (!isNaN(nRu)) { age = nRu; break; } }
                        }
                    }
                    if (age === null && usMov && usMov.release_dates && usMov.release_dates.length) {
                        for (var j = 0; j < usMov.release_dates.length; j++) {
                            var certUs = usMov.release_dates[j].certification;
                            if (certUs) { var mapped = mapUSRating(certUs); if (mapped !== null) { age = mapped; break; } }
                        }
                    }
                }
            }

            var reviews = [];
            var parseRev = function(r) { return { author: r.author || 'Аноним', text: (r.content || '').replace(/<[^>]+>/g, '').trim() }; };
            if (arr[2] && arr[2].results) reviews = arr[2].results.slice(0, 5).map(parseRev).filter(function(r){ return r.text.length > 20; });

            var checkTrailer = function(res) { return res && res.results && res.results.some(function(v){ return (v.type === 'Trailer' || v.type === 'Teaser') && v.site === 'YouTube'; }); };
            var hasTrailer = checkTrailer(arr[3]);

            var enOv = (arr[4] && arr[4].overview) ? arr[4].overview : '';

            var r = { kw: kw, age: age, reviews: reviews, hasTrailer: hasTrailer, enOv: enOv };
            _metaCache[id] = r; return r;
        }).catch(function(err) {
            console.error('[SW] loadMeta error:', err);
            return { kw: [], age: null, reviews: [], hasTrailer: false, enOv: '' };
        });
    }

    function hasKw(ctx, re) { return ctx.kw.some(function(k){ return re.test(k); }); }

    function reviewTone(reviews) {
        if (!reviews.length) return { tone: null, sample: null };
        var posRe = /шедевр|великолепн|потрясающ|восхитит|блестящ|лучш|мощн|гениальн|masterpiece|brilliant|amazing|great|best|loved|perfect|outstanding/;
        var negRe = /скучн|ужасн|провал|разочаров|слаб|затян|бессмысл|плох|boring|bad|worst|terrible|awful|disappoint|waste|dull/;
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

    function buildAudience(pros, cons, genres, rating, familyOK) {
        var hasCult = pros.some(function(p){ return p.indexOf('культовый') >= 0 || p.indexOf('классика') >= 0; });
        var hasHype = pros.some(function(p){ return p.indexOf('популярности') >= 0 || p.indexOf('хайп') >= 0; });
        var hasGem = pros.some(function(p){ return p.indexOf('находка') >= 0 || p.indexOf('жемчужина') >= 0; });
        var hasAction = pros.some(function(p){ return p.indexOf('динамика') >= 0 || p.indexOf('экшен') >= 0; });
        var hasMusic = pros.some(function(p){ return p.indexOf('музыкальная') >= 0 || p.indexOf('саундтрек') >= 0; });
        var hasDoc = pros.some(function(p){ return p.indexOf('познавательно') >= 0; });
        var hasMixed = pros.some(function(p){ return p.indexOf('эмоции') >= 0; }) || cons.some(function(c){ return c.indexOf('разочарована') >= 0 || c.indexOf('спорные') >= 0; });
        var hasViolence = cons.some(function(c){ return c.indexOf('жестокости') >= 0 || c.indexOf('насилия') >= 0; });
        var hasDrugs = cons.some(function(c){ return c.indexOf('наркотиков') >= 0; });
        var hasNudity = cons.some(function(c){ return c.indexOf('наготы') >= 0; });
        var hasThriller = hasGenre(genres, /thriller|horror|триллер|ужас/i);
        var hasComedy = hasGenre(genres, /comedy|комед/i);
        var hasDrama = hasGenre(genres, /drama|драма/i);
        var hasSciFi = hasGenre(genres, /sci-fi|fantasy|фантастик/i);

        var parts = [];
        if (hasCult && rating >= 8) parts.push('ценит признанную временем классику и глубокие сюжеты');
        else if (hasHype) parts.push('хочет быть в тренде и смотреть самые обсуждаемые новинки');
        else if (hasGem) parts.push('любит находить малоизвестные, но качественные произведения кино');
        else if (hasAction) parts.push('ищет высокий темп, драйв и насыщенные экшен-сцены');
        else if (hasThriller) parts.push('предпочитает напряженную атмосферу и неожиданные сюжетные повороты');
        else if (hasComedy) parts.push('ищет отличный повод расслабиться и посмеяться');
        else if (hasDrama && rating >= 7) parts.push('ценит сильную драматургию и глубокую раскрытость персонажей');
        else if (hasSciFi) parts.push('любит погружаться в проработанные фантастические миры');
        else if (hasDoc) parts.push('предпочитает познавательный контент и факты');
        else if (hasMusic) parts.push('обращает особое внимание на музыкальное сопровождение');
        else if (hasMixed) parts.push('готов к неоднозначным и вызывающим споры картинам');

        if (familyOK) return 'Идеально подойдет для уютного и спокойного семейного вечера';
        if (parts.length === 0) return 'Подойдет широкой аудитории для комфортного разового просмотра';

        var base = 'Рекомендуется зрителям, которые ' + parts[0];
        if (hasViolence && hasDrugs) base += ' и готовы к жестким сценам с остросоциальными темами';
        else if (hasViolence) base += ' и не против жестких или напряженных сцен';
        else if (hasDrugs) base += ' и нормально относятся к темам зависимостей';
        else if (hasNudity) base += ' и спокойно относятся к откровенным сценам';
        return base + '.';
    }

    /* ===== АНАЛИЗ С ОБЩИМ ТАЙМАУТОМ ===== */
    function analyze(movie) {
        return new Promise(function(resolve, reject) {
            // Общий таймаут 12 секунд
            var timeout = setTimeout(function() {
                console.error('[SW] analyze timeout');
                resolve({
                    pros: ['ℹ️ Не удалось загрузить полные данные'],
                    cons: [],
                    audience: 'Подойдет широкой аудитории',
                    review: { tone: null, sample: null },
                    score: 0, norm: 50,
                    vClass: 'maybe', vWord: 'СПОРНО',
                    reason: 'Данные недоступны. Проверьте подключение к интернету.',
                    mode: 'TAGS'
                });
            }, 12000);

            Promise.all([loadCredits(movie), loadMeta(movie)])
                .then(function(arr) {
                    clearTimeout(timeout);
                    var credits = arr[0], meta = arr[1];
                    var cfg = getSettings();
                    var blG = parseBL(cfg.bad_genres), blA = parseBL(cfg.bad_actors), blD = parseBL(cfg.bad_directors);
                    var now = new Date().getFullYear();

                    var q = (movie.quality || movie.source_quality || '').toString().toUpperCase();
                    var rating = parseFloat(movie.vote_average) || 0;
                    var votes = parseInt(movie.vote_count) || 0;
                    var runtime = parseInt(movie.runtime) || 0;
                    var genres = (movie.genres || []).map(function(g){ return g.name; }).filter(Boolean);
                    var ovRu = (movie.overview || '').trim();
                    var ovEn = (meta.enOv || '').trim();
                    var ovBoth = [ovRu, ovEn];
                    var age = meta.age, yr = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : 0;
                    var rt = reviewTone(meta.reviews);
                    var dataRich = !!(meta.kw.length || age !== null || meta.reviews.length || (credits && credits.crew && credits.crew.length));

                    var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){ return c.name; }).filter(Boolean);
                    var crew = credits && credits.crew || [];
                    var dirs = crew.filter(function(c){ return c.job === 'Director'; }).map(function(c){ return c.name; }).filter(Boolean);
                    var wrts = crew.filter(function(c){ return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0; }).map(function(c){ return c.name; }).filter(Boolean);
                    var ctx = { kw: meta.kw };

                    var isAnim = hasGenre(genres, /animation|мульт|анимац/i);
                    var kidsKw = hasKw(ctx, /for kids|children|kids|family-friendly|kids tv/);

                    var fDrugs    = inAnyText(ovBoth, /метамфетамин|варк|нарко|кокаин|героин|марихуан|каннабис|опиум|амфетамин/) ||
                                    inAnyText(ovBoth, /meth|cocaine|coke|heroin|marijuan|cannabis|substance|quaalude|lsd|ecstasy|opium|overdose|dealer|cartel|crack|drug use|drug deal|drug addict/) ||
                                    hasKw(ctx, /drug|narcotic|addiction|meth|cocaine|coke|heroin|marijuan|substance|quaalude|lsd|ecstasy|opium|overdose|dealer|cartel|crack/);
                    var fNudity   = inAnyText(ovBoth, /обнаж|нагот|голы/) ||
                                    inAnyText(ovBoth, /nude|nudity|strip club|stripper|topless|bare chest|full frontal|rear nudity/) ||
                                    hasKw(ctx, /nudity|female nudity|male nudity|full frontal|rear nudity|topless|bare chest|breast|strip club|stripper/);
                    var fSex      = inAnyText(ovBoth, /sex|эротик|откровен|оргазм|проститутк/) ||
                                    inAnyText(ovBoth, /orgy|threesome|one night stand|hooker|prostitut|seduction|affair|infidelity|erotic|explicit sex|orgasm|sex scene/) ||
                                    hasKw(ctx, /sex scene|sexual content|sexuality|orgy|prostitut|stripper|seduction|affair|infidelity|erotic|one night|threesome|hooker|explicit/) ||
                                    !!movie.adult;
                    var fViol     = inAnyText(ovBoth, /violenc|gore|murder|убийств|кров|жесток|насил|оружи|стрельб|резн|бойн/) ||
                                    inAnyText(ovBoth, /tortur|brutal|weapon|gun|fight|massacre|execution|stab|slaughter|bloodshed/) ||
                                    hasKw(ctx, /violenc|gore|murder|blood|tortur|brutal|weapon|gun|fight|massacre|execution|stab|slaughter/) ||
                                    hasGenre(genres, /horror|ужас/i) ||
                                    (hasGenre(genres, /crime|криминал/i) && hasGenre(genres, /thriller|триллер/i));
                    var fSmoke    = inAnyText(ovBoth, /smok|курени|сигарет/) ||
                                    inAnyText(ovBoth, /cigarette|smoking|cigar|vape/) ||
                                    hasKw(ctx, /smok|cigarette|cigar/);
                    var fAlcohol  = inAnyText(ovBoth, /alcohol|пьян|выпив|алкогол|водк|виски|пьяниц/) ||
                                    inAnyText(ovBoth, /drunkenness|drunk|booze|hangover|alcoholic|vodka|whiskey|binge/) ||
                                    hasKw(ctx, /alcohol|drunkenness|drunk|booze|hangover|alcoholic/);
                    var fProfanity= inAnyText(ovBoth, /мат|нецензур|ругательств|брани/) ||
                                    inAnyText(ovBoth, /profanity|f word|strong language|vulgarity|cursing|bad language|swearing|cuss/) ||
                                    hasKw(ctx, /profanity|f word|strong language|vulgarity|cursing|bad language|swearing|cuss/);
                    var fHate     = inAnyText(ovBoth, /hate|racis|нацист|расизм|ненавист/) || hasKw(ctx, /racis|nazi|homophob|white supremacist/);
                    var fGamb     = inAnyText(ovBoth, /casino|gambl|казино|ставк|bet|рулетк|покер/) || hasKw(ctx, /casino|gambl|betting|poker/);
                    var fAdultAnim= isAnim && hasKw(ctx, /adult animation|dark comed|black comed|dysfunctional|mature|satire/);
                    var anyAdult  = fDrugs || fNudity || fSex || fViol || fSmoke || fAlcohol || fProfanity || fHate || fAdultAnim || !!movie.adult || (age !== null && age >= 16);

                    var familyOK = !anyAdult && rating >= 6 && ((age !== null && age <= 12) || kidsKw);

                    var mG = genres.filter(function(g){ return blG.some(function(b){ return g.toLowerCase().indexOf(b) >= 0; }); });
                    var mA = cast.filter(function(a){ return blA.some(function(b){ return a.toLowerCase().indexOf(b) >= 0; }); });
                    var mD = [].concat(dirs, wrts).filter(function(p){ return blD.some(function(b){ return p.toLowerCase().indexOf(b) >= 0; }); });

                    var P = [], C = [];
                    function addP(t, w) { P.push({ t: t, w: w }); }
                    function addC(t, w) { C.push({ t: t, w: w }); }

                    if (rating >= 8.0 && votes >= 3000) addP('⭐ Высокое зрительское признание и отличные оценки критиков', 30);
                    else if (rating >= cfg.min_rating && votes >= 100) addP('⭐ Стабильно положительный прием у аудитории', 18);
                    if (rating > 0 && rating < cfg.min_rating && votes >= 100) addC('📉 Оценки ниже желаемого порога (' + rating.toFixed(1) + ')', 22);
                    if (rating >= 7.8 && votes >= 100 && votes < 1500) addP('🔎 Настоящий редкий самородок: высокий рейтинг в узком кругу ценителей', 16);
                    if (rating >= 8.0 && votes >= 2000 && yr > 0 && yr <= now - 3) addP('🏛 Проверено временем: признанная классика с культовым статусом', 18);
                    if (yr >= now - 1 && votes >= 200) addP('🔥 На пике популярности: громкая новинка, которую активно обсуждают', 10);
                    if (votes > 0 && votes < 30) addC('❓ Малое количество оценок: рейтинг пока не отображает реальное качество', 8);

                    if (rt.tone === 'pos') addP('💬 Восторженные отзывы: зрители хвалят фильм за глубокую атмосферу и качество', 20);
                    else if (rt.tone === 'neg') addC('💬 Сдержанные отзывы: зрители часто критикуют сюжет, логику или темп', 22);
                    else if (rt.tone === 'mix') { addP('💬 Вызывает яркие эмоции: проект оставляет неоднозначные, но глубокие впечатления', 6); addC('💬 Спорные моменты: часть аудитории осталась разочарована', 8); }

                    if (q && !/CAM|TS|HDCAM|SCR|WORKPRINT/i.test(q)) addP('🎥 Отличное качество: доступно в четком высоком разрешении (' + q + ')', 8);
                    if (runtime > 0 && runtime <= 120) addP('🕐 Комфортный хронометраж: идеально подходит для вечернего просмотра (' + runtime + ' мин.)', 6);
                    if (familyOK) addP('👨‍👩‍👧‍👦 Безопасно для семейного просмотра: подходит для всех возрастов', 14);
                    if (hasGenre(genres, /documentary|документ/i)) addP('🧠 Познавательно и увлекательно: расширяет кругозор', 8);
                    if (inAnyText(ovBoth, /soundtrack|music|composer|score|музык|композитор/) || hasKw(ctx, /music|soundtrack|composer/)) addP('🎵 Выдающийся саундтрек: отличная музыкальная составляющая', 8);
                    if (hasGenre(genres, /action|боевик/i)) addP('💥 Высокая динамика: захватывающие экшен-сцены и драйв', 8);
                    if (meta.hasTrailer) addP('▶ Доступен трейлер: можно оценить атмосферу за пару минут', 4);

                    if (mG.length) addC('⛔ Нелюбимый жанр: ' + mG.join(', '), 40);
                    if (mA.length) addC('⛔ Нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '), 35);
                    if (mD.length) addC('⛔ Нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '), 35);

                    if (fNudity) addC('🫣 Откровенные сцены наготы', 14);
                    if (fSex) addC('💋 Явный сексуальный контент', 14);
                    if (fSmoke) addC('🚬 Демонстрация курения в кадре', 8);
                    if (fAlcohol) addC('🍺 Сцены употребления алкоголя', 10);
                    if (fGamb) addC('🎰 Темы азартных игр и ставок', 10);
                    if (fViol) addC('🔪 Высокий уровень жестокости и насилия', 16);
                    if (fDrugs) addC('💉 Деликатная тема наркотиков', 16);
                    if (fProfanity) addC('🤬 Нецензурная лексика', 8);
                    if (fHate) addC('🚩 Мотивы вражды или расизма', 16);
                    if (runtime > 180) addC('⌛ Внушительный хронометраж (' + runtime + ' мин.): может потребоваться перерыв', 10);
                    if (/CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT/i.test(q || '')) addC('⚠️ Экранная копия (CAM/TS): качество видео и звука существенно испортит впечатление', 24);
                    if (age !== null && age >= 16) addC('🔞 Возрастной ценз ' + age + '+: не подходит для семейного просмотра', 12);
                    if (isAnim && !familyOK) addC('🔞 Взрослая анимация: возможен специфический юмор и серьезные темы', 14);

                    var adultAge = (age !== null && age >= 16);
                    var noSpecific = !fNudity && !fSex && !fProfanity && !fViol && !fDrugs && !fAlcohol;
                    if (adultAge && noSpecific) addC('🔞 Возрастной рейтинг ' + age + '+: вероятны откровенные сцены или жестокость', 14);

                    var score = 0;
                    P.forEach(function(x){ score += x.w; });
                    C.forEach(function(x){ score -= x.w; });
                    if (score > 100) score = 100; if (score < -100) score = -100;
                    var norm = Math.round((score + 100) / 2);
                    var vClass = score >= 30 ? 'yes' : (score <= -30 ? 'no' : 'maybe');
                    var vWord = score >= 30 ? 'СТОИТ' : (score <= -30 ? 'НЕ СТОИТ' : 'СПОРНО');

                    var topP = P.slice().sort(function(a,b){ return b.w - a.w; })[0];
                    var topC = C.slice().sort(function(a,b){ return b.w - a.w; })[0];
                    function strip(t) { return t ? t.replace(/^[^\s]+\s/, '') : ''; }

                    var reason = '';
                    if (vClass === 'yes') reason = 'Сильные стороны существенно перевешивают' + (topP ? ' — ключевой плюс: ' + strip(topP.t) : '') + '. Кино определенно заслуживает внимания.';
                    else if (vClass === 'no') reason = 'Серьезные минусы перевешивают впечатление' + (topC ? ' — главный недостаток: ' + strip(topC.t) : '') + '. Высокий риск разочарования.';
                    else reason = 'Мнения и факты разделились поровну — проект неоднозначный' + (topP && topC ? ': с одной стороны ' + strip(topP.t) + ', но с другой ' + strip(topC.t) : '') + '. Стоит решать по собственному вкусу.';
                    if (!dataRich) reason += ' Данных о картине пока маловато, поэтому вердикт осторожный.';

                    var pros = P.map(function(x){ return x.t; });
                    var cons = C.map(function(x){ return x.t; });
                    if (!pros.length) pros.push('ℹ️ Недостаточно данных для выделения сильных сторон');
                    if (!cons.length) cons.push((blG.length || blA.length || blD.length) ? '✅ Под ваши фильтры ничего не попало' : '✅ Явных минусов не обнаружено');

                    var audience = buildAudience(pros, cons, genres, rating, familyOK);

                    resolve({
                        pros: pros, cons: cons, audience: audience,
                        review: rt, score: score, norm: norm,
                        vClass: vClass, vWord: vWord, reason: reason,
                        mode: dataRich ? 'TMDB' : 'TAGS'
                    });
                })
                .catch(function(err) {
                    clearTimeout(timeout);
                    console.error('[SW] analyze error:', err);
                    resolve({
                        pros: ['ℹ️ Не удалось загрузить полные данные'],
                        cons: [],
                        audience: 'Подойдет широкой аудитории',
                        review: { tone: null, sample: null },
                        score: 0, norm: 50,
                        vClass: 'maybe', vWord: 'СПОРНО',
                        reason: 'Ошибка загрузки данных. Проверьте подключение к интернету.',
                        mode: 'TAGS'
                    });
                });
        });
    }

    /* ===== BACK / КОНТРОЛЛЕР ===== */
    function restorePrev() {
        var prev = window._sw_prevController; window._sw_prevController = null;
        try { if (prev && prev.name) Lampa.Controller.toggle(prev.name); else Lampa.Controller.toggle('full_start'); }
        catch(e) { try { Lampa.Controller.toggle('full'); } catch(_) {} }
    }

    function registerController() {
        if (window._sw_controllerRegistered) return;
        window._sw_controllerRegistered = true;
        try {
            Lampa.Controller.add('should_watch_modal', {
                toggle: function() {
                    var h = window._sw_currentModalHtml;
                    if (h && h.length) {
                        var focusables = h.find('.sw-focusable');
                        Lampa.Controller.collectionSet(focusables);
                        var el = focusables.eq(window._sw_focusIdx || 0);
                        if (el.length) Lampa.Controller.collectionFocus(el);
                    }
                },
                up: function() { swSetFocus(window._sw_focusIdx - 1); },
                down: function() { swSetFocus(window._sw_focusIdx + 1); },
                left: function() {},
                right: function() {},
                back: function() {
                    if (window._sw_closingFromController) return;
                    window._sw_closingFromController = true;
                    try { Lampa.Modal.close(); } catch(e) {}
                    restorePrev();
                }
            });
        } catch(e) { console.error('[SW] registerController:', e); }
    }

    /* ===== РЕНДЕР ===== */
    function renderModal(html, res) {
        try {
            var prosList = res.pros.map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('');
            var consList = res.cons.map(function(c){ return '<li>' + esc(c) + '</li>'; }).join('');

            var quoteHtml = '';
            if (res.review && res.review.sample) {
                var toneClass = res.review.tone === 'pos' ? 'pos' : (res.review.tone === 'neg' ? 'neg' : 'mix');
                var toneLabel = res.review.tone === 'pos' ? 'Положительный' : (res.review.tone === 'neg' ? 'Критический' : 'Смешанный');
                quoteHtml = '<div class="sw-quote sw-focusable" tabindex="0"><div class="sw-quote-text">«' + esc(res.review.sample.text.slice(0, 240)) + (res.review.sample.text.length > 240 ? '...' : '') + '»</div><div class="sw-quote-meta">Мнение зрителя: ' + esc(res.review.sample.author) + ' <span class="sw-quote-tone ' + toneClass + '">' + toneLabel + '</span></div></div>';
            }

            var bHtml =
                '<div class="sw-body">' +
                    '<div class="sw-dossier sw-focusable" tabindex="0">' +
                        '<div class="sw-mode-badge ' + (res.mode === 'TMDB' ? 'tmdb' : 'tags') + '"><span class="sw-mode-dot active"></span>' + res.mode + ' ANALYTICS</div>' +
                        '<div class="sw-verdict-word ' + res.vClass + '">' + esc(res.vWord) + '</div>' +
                        '<div class="sw-verdict-reason">' + esc(res.reason) + '</div>' +
                        '<div class="sw-meter"><div class="sw-meter-fill ' + res.vClass + '" style="width:' + res.norm + '%"></div></div>' +
                    '</div>' +
                    '<div class="sw-columns">' +
                        '<div class="sw-col sw-focusable" tabindex="0"><div class="sw-title pros">➕ Сильные стороны</div><ul class="sw-list">' + prosList + '</ul></div>' +
                        '<div class="sw-col sw-focusable" tabindex="0"><div class="sw-title cons">➖ Подводные камни</div><ul class="sw-list">' + consList + '</ul></div>' +
                    '</div>' +
                    quoteHtml +
                    '<div class="sw-target-audience sw-focusable" tabindex="0"><div class="sw-title target">🎯 Кому подойдет</div><div class="sw-aud-text">' + esc(res.audience) + '</div></div>' +
                    '<div class="sw-decision sw-focusable" tabindex="0">' +
                        '<div class="sw-decision-hint">Сомневаешься? Брось жребий!</div>' +
                        '<div class="sw-dice-btn" id="sw-dice-btn">🎲 БРОСИТЬ КУБИК</div>' +
                        '<div class="sw-verdict-roll" id="sw-verdict"></div>' +
                    '</div>' +
                '</div>';

            html.html(bHtml);

            html.find('#sw-dice-btn').on('click hover:enter keydown', function(e) {
                if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                if (window._sw_rolling) return;
                window._sw_rolling = true;
                var btn = $(this);
                var roll = html.find('#sw-verdict');
                btn.addClass('shake');
                roll.removeClass('verdict-yes verdict-no').text('Крутим...');
                setTimeout(function() {
                    try {
                        btn.removeClass('shake');
                        var isYes = Math.random() >= 0.5;
                        roll.addClass(isYes ? 'verdict-yes' : 'verdict-no').text(isYes ? '🎲 КУБИК ГОВОРИТ: СМОТРЕТЬ!' : '🎲 КУБИК ГОВОРИТ: ПРОПУСТИТЬ!');
                    } catch(err) { console.error('[SW] dice render:', err); }
                    window._sw_rolling = false;
                }, 600);
            });
        } catch(e) {
            console.error('[SW] renderModal:', e);
            html.html('<div class="sw-body" style="text-align:center;padding:40px;color:#d9534f">Ошибка рендера</div>');
        }
    }

    /* ===== ПОКАЗ МОДАЛКИ ===== */
    function showModal(movie) {
        try {
            if (!movie) { console.error('[SW] showModal: пустой movie'); return; }

            var prev = null;
            try { prev = Lampa.Controller.enabled ? Lampa.Controller.enabled() : null; } catch(e) {}
            window._sw_prevController = prev;
            window._sw_closingFromController = false;
            window._sw_focusIdx = 0;

            var html = $('<div class="sw-modal-content"><div class="sw-loader"><div class="sw-loader-dice">🎲</div><div class="sw-loader-text">Анализируем отзывы и рейтинги...</div><div class="sw-loader-bar"></div></div></div>');
            window._sw_currentModalHtml = html;

            var title = esc(movie.title || movie.name || 'Фильм');

            Lampa.Modal.open({
                title: 'Стоит ли смотреть: ' + title,
                html: html,
                size: 'large',
                zIndex: 1000,
                onBack: function() {
                    if (window._sw_closingFromController) { window._sw_closingFromController = false; return; }
                    window._sw_closingFromController = true;
                    restorePrev();
                }
            });

            Lampa.Controller.toggle('should_watch_modal');

            analyze(movie).then(function(res) {
                if (!window._sw_currentModalHtml) return;
                renderModal(html, res);
                swSetFocus(0);
            }).catch(function(err) {
                console.error('[SW] analyze error:', err);
                if (window._sw_currentModalHtml) {
                    html.html('<div class="sw-body" style="text-align:center;padding:40px;color:#d9534f">Не удалось собрать данные. Попробуйте позже.</div>');
                }
            });
        } catch(e) { console.error('[SW] showModal:', e); }
    }

    /* ===== ИНТЕГРАЦИЯ В КАРТОЧКУ ===== */
    function addBtn(el, movie) {
        try {
            if (!el || !el.length || el.find('.sw-btn-should-watch').length) return;
            if (!movie) return;
            var btn = $('<div class="full-start__button selector sw-btn-should-watch" data-type="should_watch">' +
                '<div class="full-start__icon">' + ICON + '</div>' +
                '<span>Стоит ли?</span>' +
                '</div>');
            btn.on('hover:enter click', function() { if (movie) showModal(movie); });
            var anchor = el.find('.view--torrent,.view--online,.view--trailer').last();
            if (anchor.length) anchor.after(btn);
            else {
                var fb = el.find('.full-start__buttons,.full-start-new__buttons,.full-card__buttons').first();
                if (fb.length) fb.append(btn);
            }
        } catch(e) { console.error('[SW] addBtn:', e); }
    }

    /* ===== СТАРТ ПЛАГИНА ===== */
    function startPlugin() {
        try { injectCSS(); } catch(e) {}
        try { initSettings(); } catch(e) {}
        try { registerController(); } catch(e) {}
        try {
            Lampa.Listener.follow('full', function(e) {
                if (e.type !== 'complite') return;
                try {
                    var render = e.object && e.object.activity ? e.object.activity.render() : null;
                    var movie = e.data && e.data.movie ? e.data.movie : null;
                    if (render && movie) addBtn(render, movie);
                } catch(err) { console.error('[SW] listener full:', err); }
            });
        } catch(e) { console.error('[SW] listener setup:', e); }
        console.log('[ShouldWatch] v24.0 initialized (timeout protection).');
    }

    try {
        if (window.appready) startPlugin();
        else Lampa.Listener.follow('app', function(e){ if (e.type === 'ready') startPlugin(); });
    } catch(e) { console.error('[SW] appready:', e); }
})();
