(function () {
    'use strict';
    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;

    var PLUGIN_ID = 'should_watch_plugin_enhanced';
    var ICON = '<svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="8" stroke-linecap="square" fill="none"><path d="M20,55 L40,75 L80,25"/><path d="M25,25 L75,75" stroke-dasharray="4,4"/></g></svg>';
    var DISPLAY = '"Trebuchet MS","Segoe UI",system-ui,sans-serif';
    var GENRE_ID_ANIM = 16, GENRE_ID_FAMILY = 10751, GENRE_ID_KIDS = 10762;

    window._sw_rolling = false;
    window._sw_currentModalHtml = null;
    window._sw_prevController = null;
    window._sw_closingFromController = false;
    window._sw_loaderTimer = null;
    window._sw_blocknav = false;
    window._sw_activeInteractive = null;
    window._sw_keyBound = false;
    var _metaCache = {};

    function getSetting(k, d) { try { var v = Lampa.Storage.get(PLUGIN_ID + '_' + k); if (v !== undefined && v !== null && v !== '') return v; } catch(e) {} return d; }
    function getSettings() {
        return {
            bad_genres: String(getSetting('bad_genres', '') || ''),
            bad_actors: String(getSetting('bad_actors', '') || ''),
            bad_directors: String(getSetting('bad_directors', '') || ''),
            kp_token: String(getSetting('kp_token', '') || ''),
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
                { name: 'kp_token', type: 'input', title: 'Кинопоиск API-токен', description: 'Опционально, api.kinopoisk.dev', default: '' },
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

    function injectCSS() {
        try {
            if (document.getElementById('sw-plugin-styles-enhanced')) return;
            var s = document.createElement('style'); s.id = 'sw-plugin-styles-enhanced';
            s.innerHTML =
                '.sw-modal-content{padding:20px 24px 40px;color:#fff;font-family:' + DISPLAY + ';box-sizing:border-box}' +
                '.sw-body{animation:swFadeIn .45s ease}' +
                '@keyframes swFadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}' +
                '.sw-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:70px 20px;min-height:50vh;color:#9aa1a6}' +
                '.sw-loader-emoji{font-size:3.4em;line-height:1;animation:swFloat 2.2s ease-in-out infinite}' +
                '@keyframes swFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}' +
                '.sw-loader-text{font-size:1.05em;font-weight:600;min-height:1.5em;transition:opacity .25s ease;text-align:center}' +
                '.sw-loader-progress{width:220px;height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;position:relative;margin-top:8px}' +
                '.sw-loader-progress::after{content:"";position:absolute;left:-100%;top:0;height:100%;width:100%;background:linear-gradient(90deg,transparent,#7ec260,transparent);animation:swSlide 1.6s linear infinite}' +
                '@keyframes swSlide{0%{left:-100%}100%{left:100%}}' +
                '.sw-dossier{position:relative;background:#2b2e31;border-radius:16px;padding:26px 28px;margin-bottom:18px;animation:swRise .5s cubic-bezier(.22,1,.36,1) both}' +
                '@keyframes swRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}' +
                '.sw-badges{position:absolute;top:18px;right:18px;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:55%}' +
                '.sw-mode-badge{display:inline-flex;align-items:center;gap:6px;font-size:.68em;padding:4px 12px;border-radius:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:rgba(255,255,255,.07);color:#9aa1a6}' +
                '.sw-mode-dot{width:5px;height:5px;border-radius:50%;display:inline-block}' +
                '.sw-mode-dot.active{background:#7ec260;box-shadow:0 0 8px rgba(126,194,96,.8)}' +
                '.sw-mode-dot.inactive{background:#7d8388}' +
                '.sw-mode-dot.dead{background:#e05b56;box-shadow:0 0 8px rgba(224,91,86,.8)}' +
                '.sw-verdict-word{font-size:2.7em;font-weight:800;letter-spacing:.01em;line-height:1;margin:0 0 16px;text-transform:uppercase;opacity:0;transform:translateY(8px);transition:opacity .45s ease,transform .45s ease}' +
                '.sw-verdict-word.appear{opacity:1;transform:translateY(0)}' +
                '.sw-verdict-word.yes{color:#7ec260}.sw-verdict-word.no{color:#e05b56}.sw-verdict-word.maybe{color:#e0a93b}' +
                '.sw-meter{height:5px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden}' +
                '.sw-meter-fill{height:100%;width:0;border-radius:3px;transition:width 1s cubic-bezier(.25,.8,.3,1)}' +
                '.sw-meter-fill.yes{background:#7ec260}.sw-meter-fill.no{background:#e05b56}.sw-meter-fill.maybe{background:#e0a93b}' +
                '.sw-dicebtn{position:relative;display:block;width:100%;height:104px;background:#f2f3f5;border:none;border-radius:16px;margin:0 0 20px;overflow:hidden;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent}' +
                '.sw-dicebtn.focus{box-shadow:0 0 0 3px rgba(255,255,255,.85),0 0 18px rgba(255,255,255,.18)}' +
                '.sw-custom-button-enhanced,.sw-custom-button-enhanced.focus{outline:none}' +
                '.sw-custom-button-enhanced.focus{background:rgba(255,255,255,.16);color:#fff;box-shadow:none;border-color:transparent}' +
                '.sw-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:' + DISPLAY + ';font-size:2.2em;font-weight:800;color:#878c91;letter-spacing:.01em;padding:0 108px;text-align:center;white-space:nowrap;overflow:hidden}' +
                '.sw-label.res-yes{color:#3f8f2f}.sw-label.res-no{color:#c9443f}' +
                '.sw-dice{position:absolute;left:16px;top:50%;width:74px;height:74px;margin-top:-37px;will-change:transform;transform:translateZ(0)}' +
                '.sw-dice svg{width:100%;height:100%;display:block;transform:rotate(-8deg)}' +
                '.sw-dice.sw-rolling{animation:swRoll 1.05s cubic-bezier(.33,.65,.3,1) forwards}' +
                '@keyframes swRoll{0%{transform:translateX(0) rotate(0) translateY(0)}20%{transform:translateX(calc(var(--sw-dist) * .2)) rotate(140deg) translateY(-12px)}40%{transform:translateX(calc(var(--sw-dist) * .42)) rotate(280deg) translateY(0)}60%{transform:translateX(calc(var(--sw-dist) * .63)) rotate(430deg) translateY(-9px)}80%{transform:translateX(calc(var(--sw-dist) * .84)) rotate(580deg) translateY(0)}100%{transform:translateX(var(--sw-dist)) rotate(720deg) translateY(0)}}' +
                '.sw-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}' +
                '.sw-col{position:relative;background:#2b2e31;border-radius:14px;padding:22px 24px}' +
                '.sw-col::before{content:"";position:absolute;top:0;left:24px;right:24px;height:2px;border-radius:2px}' +
                '.sw-col.pros::before{background:#7ec260}.sw-col.cons::before{background:#e05b56}' +
                '.sw-title{font-size:.85em;font-weight:800;margin-bottom:14px;text-transform:uppercase;letter-spacing:.05em}' +
                '.sw-title.pros{color:#7ec260}.sw-title.cons{color:#e05b56}' +
                '.sw-list{margin:0;padding-left:20px;font-size:.96em;line-height:1.6;color:#c6ccd0}' +
                '.sw-list li{margin-bottom:9px;opacity:0;transform:translateX(-8px);transition:opacity .4s ease,transform .4s ease}' +
                '.sw-list li.appear{opacity:1;transform:translateX(0)}' +
                '.sw-quote{background:#2b2e31;border-left:3px solid #7ec260;border-radius:12px;padding:18px 22px;margin-bottom:20px}' +
                '.sw-quote.neg{border-left-color:#e05b56}.sw-quote.mix{border-left-color:#e0a93b}' +
                '.sw-quote-text{font-size:.98em;line-height:1.65;color:#dfe3e6;font-style:italic}' +
                '.sw-quote-meta{margin-top:10px;font-size:.8em;color:#8d949a}' +
                '.sw-focusable{outline:none;cursor:pointer}' +
                '@media(max-width:640px){.sw-modal-content{padding:14px 14px 30px}.sw-columns{grid-template-columns:1fr}.sw-verdict-word{font-size:2.1em}.sw-label{font-size:1.5em;padding:0 88px}.sw-dice{width:60px;height:60px;margin-top:-30px;left:12px}}';
            document.head.appendChild(s);
        } catch(e) { console.error('[SW] injectCSS:', e); }
    }

    var escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function esc(s) { if (typeof s !== 'string') return ''; return s.replace(/[&<>"']/g, function(m){ return escMap[m]; }); }
    function hasGenre(g, re) { return g.some(function(x){ return re.test((x || '').toLowerCase()); }); }
    function inText(s, re) { return re.test((s || '').toLowerCase()); }
    function inAnyText(texts, re) { return texts.some(function(s){ return inText(s, re); }); }
    function mediaType(m) { return (m && m.name && !m.title) ? 'tv' : 'movie'; }
    function uniq(arr) { return arr.filter(function(v,i,s){ return s.indexOf(v) === i; }); }
    function fmtN(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

    function findScrollParent(node) {
        try {
            var el = node;
            while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
                var oy = window.getComputedStyle(el).overflowY;
                if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 4) return el;
                el = el.parentNode;
            }
        } catch(e) {}
        return document.scrollingElement || document.documentElement;
    }
    function getScrollContainer() {
        var h = window._sw_currentModalHtml;
        if (!h || !h.length) return null;
        var inner = h.find('.sw-modal-content')[0] || h[0];
        return findScrollParent(inner);
    }
    function scrollContainerTo(el, center) {
        if (!window._sw_blocknav) return;
        try {
            if (!el || !el.length) return;
            var cn = getScrollContainer(); if (!cn) return;
            var cRect = cn.getBoundingClientRect(), eRect = el[0].getBoundingClientRect();
            var delta = eRect.top - cRect.top, target;
            if (center) target = cn.scrollTop + delta - (cn.clientHeight / 2) + (eRect.height / 2);
            else if (eRect.top < cRect.top + 8) target = cn.scrollTop + delta - 20;
            else if (eRect.bottom > cRect.bottom - 8) target = cn.scrollTop + (eRect.bottom - cRect.bottom) + 20;
            else return;
            try { $(cn).stop(true, false).animate({ scrollTop: target }, 200, 'swing'); }
            catch(e) { cn.scrollTop = target; }
        } catch(e) {}
    }
    function interactiveSet() { var h = window._sw_currentModalHtml; if (!h) return $(); return h.find('.sw-focusable:visible'); }
    function focusRing(el, doScroll) {
        var h = window._sw_currentModalHtml; if (!h) return;
        h.find('.sw-focusable').removeClass('focus');
        el.addClass('focus');
        window._sw_activeInteractive = el[0];
        if (doScroll !== false) scrollContainerTo(el, false);
    }
    function highlightVisible() {
        if (!window._sw_blocknav) return;
        var set = interactiveSet(); if (!set.length) return;
        var cn = getScrollContainer(), mid;
        if (cn) { var r = cn.getBoundingClientRect(); mid = r.top + r.height / 2; } else mid = window.innerHeight / 2;
        var best = null, bd = 1e9;
        set.each(function(){ var rr = this.getBoundingClientRect(); var d = Math.abs((rr.top + rr.height/2) - mid); if (d < bd) { bd = d; best = this; } });
        if (best) focusRing($(best), false);
    }
    function moveHorizontal(dir) {
        if (!window._sw_blocknav) return;
        var set = interactiveSet(); if (!set.length) return;
        var idx = -1;
        if (window._sw_activeInteractive) idx = set.index(window._sw_activeInteractive);
        if (idx < 0) idx = dir > 0 ? -1 : 0;
        var n = idx + dir; if (n < 0) n = set.length - 1; if (n >= set.length) n = 0;
        focusRing(set.eq(n));
    }
    function scrollStep(dir) {
        if (!window._sw_blocknav) return;
        var cn = getScrollContainer(); if (!cn) return;
        var step = Math.max(100, Math.round(cn.clientHeight * 0.6));
        var maxScroll = Math.max(0, cn.scrollHeight - cn.clientHeight);
        var target = Math.min(Math.max(0, cn.scrollTop + dir * step), maxScroll);
        try { $(cn).stop(true, false).animate({ scrollTop: target }, 200, 'swing', highlightVisible); }
        catch(e) { cn.scrollTop = target; highlightVisible(); }
    }

    function genreByIdOrName(genresRaw, ids, nameRe) {
        if (!genresRaw || !genresRaw.length) return false;
        for (var i = 0; i < genresRaw.length; i++) {
            var g = genresRaw[i];
            if (g && typeof g === 'object') {
                if (g.id && ids.indexOf(g.id) >= 0) return true;
                if (nameRe.test((g.name || '').toLowerCase())) return true;
            } else if (typeof g === 'string') { if (nameRe.test(g.toLowerCase())) return true; }
        }
        return false;
    }
    function loadCredits(movie) {
        try {
            if (movie.credits && ((movie.credits.cast && movie.credits.cast.length) || (movie.credits.crew && movie.credits.crew.length))) return Promise.resolve(movie.credits);
            var id = movie.id || movie.tmdb_id; if (!id) return Promise.resolve(null);
            if (Lampa.TMDB && typeof Lampa.TMDB.credits === 'function') {
                return new Promise(function(res){ Lampa.TMDB.credits(id, function(d){ res(d && !d.status_code ? d : null); }, function(){ res(null); }); });
            }
        } catch(e) {}
        return Promise.resolve(null);
    }
    function tmdbKey() { try { if (Lampa.TMDB && Lampa.TMDB.key) return Lampa.TMDB.key; } catch(e) {} return '4ef0d7355d9ffb5151e987764708ce96'; }
    function curLangCode() { try { var l = Lampa.Storage.get('language', 'ru') || 'ru'; return l + '-' + l.toUpperCase(); } catch(e) { return 'ru-RU'; } }
    function tmdbGet(path, lang) {
        return new Promise(function(res){
            try {
                var langCode = lang || curLangCode();
                var url = 'https://api.themoviedb.org/3' + path + (path.indexOf('?') > -1 ? '&' : '?') + 'language=' + langCode + '&api_key=' + tmdbKey();
                if (Lampa.Request && typeof Lampa.Request.get === 'function') {
                    Lampa.Request.get(url, function(d){ res(d && d.status_code ? null : d); }, function(){ res(null); }, { dataType: 'json' });
                } else if (typeof fetch !== 'undefined') {
                    fetch(url).then(function(r){ return r.json(); }).then(function(d){ res(d && d.status_code ? null : d); }).catch(function(){ res(null); });
                } else res(null);
            } catch(e) { res(null); }
        });
    }
    function mapUSRating(s) {
        return { 'G':0,'PG':7,'PG-13':13,'R':17,'NC-17':17,'TV-MA':17,'TV-14':14,'TV-PG':7,'TV-G':0,'TV-Y7':7,'TV-Y':0,'MA':17,'18':18,'16':16,'12':12,'12A':12,'15':15 }[(s || '').toUpperCase().trim()] || null;
    }
    function loadMeta(movie) {
        var id = movie.id || movie.tmdb_id;
        if (!id) return Promise.resolve({ kw: [], age: null, reviews: [], hasTrailer: false, enOv: '' });
        if (_metaCache[id]) return Promise.resolve(_metaCache[id]);
        if (Object.keys(_metaCache).length > 100) _metaCache = {};
        var type = mediaType(movie);
        return Promise.all([
            tmdbGet('/' + type + '/' + id + '/keywords'),
            tmdbGet('/' + type + '/' + id + '/content_ratings'),
            tmdbGet('/' + type + '/' + id + '/reviews'),
            tmdbGet('/' + type + '/' + id + '/videos'),
            tmdbGet('/' + type + '/' + id, 'en-US')
        ]).then(function(arr){
            var kw = [];
            if (arr[0]) (arr[0].keywords || arr[0].results || []).forEach(function(k){ if (k && k.name) kw.push(k.name.toLowerCase()); });
            var age = null;
            if (arr[1] && arr[1].results) {
                var ru = arr[1].results.find(function(x){ return x.iso_3166_1 === 'RU'; });
                var us = arr[1].results.find(function(x){ return x.iso_3166_1 === 'US'; });
                if (ru && ru.rating) { var n = parseInt(ru.rating); if (!isNaN(n)) age = n; }
                if (age === null && us && us.rating) age = mapUSRating(us.rating);
                if (age === null && arr[1].results.length) { var f = arr[1].results[0]; if (f.rating) { var n2 = parseInt(f.rating); age = !isNaN(n2) ? n2 : mapUSRating(f.rating); } }
            }
            var reviews = [];
            if (arr[2] && arr[2].results) reviews = arr[2].results.slice(0, 6).map(function(r){ return { author: r.author || 'Аноним', text: (r.content || '').replace(/<[^>]+>/g, '').trim() }; }).filter(function(r){ return r.text.length > 20; });
            var hasTrailer = false;
            if (arr[3] && arr[3].results) hasTrailer = arr[3].results.some(function(v){ return v.type === 'Trailer' && v.site === 'YouTube'; });
            var enOv = (arr[4] && arr[4].overview) ? arr[4].overview : '';
            var r = { kw: kw, age: age, reviews: reviews, hasTrailer: hasTrailer, enOv: enOv };
            _metaCache[id] = r; return r;
        });
    }
    function hasKw(ctx, re) { return ctx.kw.some(function(k){ return re.test(k); }); }
    function reviewStats(reviews) {
        var posRe = /шедевр|великолепн|потрясающ|восхитит|блестящ|лучш|мощн|гениальн|masterpiece|brilliant|amazing|great|best|loved|perfect|outstanding|must-watch|замечательн|превосходн|отличн|весел|смешн|funny|понрав|советую|хорош/i;
        var negRe = /скучн|ужасн|провал|разочаров|слаб|затян|бессмысл|плох|boring|bad|worst|terrible|awful|disappoint|waste|dull|pointless|утомительн|неинтересн/i;
        var pos = 0, neg = 0, firstPos = null, firstNeg = null;
        reviews.forEach(function(r){
            var t = r.text.toLowerCase();
            var p = (t.match(posRe) || []).length, n = (t.match(negRe) || []).length;
            if (p > n) { pos++; if (!firstPos) firstPos = r; } else if (n > p) { neg++; if (!firstNeg) firstNeg = r; }
        });
        var tone = (pos === 0 && neg === 0) ? null : (pos > neg ? 'pos' : (neg > pos ? 'neg' : 'mix'));
        return { total: reviews.length, pos: pos, neg: neg, tone: tone, sample: (tone === 'neg' ? firstNeg : firstPos) || reviews[0] };
    }

    /* ===== КИНОПОИСК (опционально) ===== */
    function kpGet(url) {
        return new Promise(function(res){
            try {
                if (typeof fetch === 'undefined') return res(null);
                fetch(url, { headers: { 'X-API-KEY': getSettings().kp_token, 'Accept': 'application/json' } })
                    .then(function(r){ return r.status === 200 ? r.json() : null; })
                    .then(function(d){ res(d || null); })
                    .catch(function(){ res(null); });
            } catch(e){ res(null); }
        });
    }
    function loadKp(movie) {
        if (!getSettings().kp_token) return Promise.resolve(null);
        var title = (movie.title || movie.name || '').trim();
        if (!title) return Promise.resolve({ reviews: null, age: null, status: 'fail' });
        var yr = movie.release_date ? movie.release_date.substring(0, 4) : '';
        return kpGet('https://api.kinopoisk.dev/v1.4/movie/search?query=' + encodeURIComponent(title) + (yr ? '&year=' + yr : '') + '&limit=1').then(function(s){
            if (!s || !s.docs || !s.docs.length) return { reviews: null, age: null, status: 'fail' };
            var doc = s.docs[0];
            var id = doc.id || doc.kinopoiskId || null;
            var ageKp = null;
            var ra = doc.ratingAge || doc.ageRating || (doc.rating && (doc.rating.ageRating || doc.rating.age)) || null;
            if (ra !== null && ra !== undefined) {
                var m2 = String(ra).match(/(\d{1,2})\s?\+/);
                if (m2) ageKp = parseInt(m2[1], 10);
                else if (!isNaN(parseInt(ra, 10)) && parseInt(ra, 10) <= 21) ageKp = parseInt(ra, 10);
            }
            if (!id) return { reviews: null, age: ageKp, status: 'ok' };
            return kpGet('https://api.kinopoisk.dev/v1.3/review?filmId=' + id + '&page=1&limit=8').then(function(r){
                var list = null;
                if (r && r.docs && r.docs.length) {
                    list = r.docs.map(function(x){ return { author: x.author || 'Аноним', text: String(x.review || x.title || '').trim() }; }).filter(function(x){ return x.text.length > 20; });
                    if (!list.length) list = null;
                }
                return { reviews: list, age: ageKp, status: 'ok' };
            });
        }).catch(function(){ return { reviews: null, age: null, status: 'fail' }; });
    }

    /* ===== DOM-сигналы из карточки Lampa: настроения + возраст (возраст — всегда) ===== */
    function readDomSignals() {
        var out = { mm: {}, moods: [], ok: false, age: null };
        try {
            var txt = document.body.innerText || '';
            var am = txt.match(/\b(6|12|16|18)\+/);
            if (am) out.age = parseInt(am[1], 10);
            var mm = {}, found = 0;
            [['pace','Темп'],['fear','Страх'],['action','Экшн'],['violence','Насилие'],['sadness','Грусть'],['language','Лексика']].forEach(function(p){
                var r = txt.match(new RegExp(p[1] + '[\\s\\S]{0,60}?([\\d.,]+)\\s*/\\s*10'));
                if (r) { mm[p[0]] = parseFloat(r[1].replace(',', '.')); found++; }
            });
            var moods = [];
            var mi = txt.indexOf('Настроения');
            if (mi > -1) {
                var chunk = txt.substring(mi + 10, mi + 1600);
                var re = /(\d{1,3})\s*%\s*\n?\s*([А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z….\-]{2,24})/g, r2;
                while ((r2 = re.exec(chunk)) && moods.length < 12) moods.push({ name: r2[2].trim(), pct: parseInt(r2[1]) });
            }
            if (found >= 3 || moods.length >= 3) { out.mm = mm; out.moods = moods; out.ok = true; }
        } catch(e) {}
        return out;
    }
    function computeMoods(kw, genres) {
        function cnt(list) { var c = 0; list.forEach(function(re){ if (kw.some(function(k){ return re.test(k); })) c++; }); return c; }
        var fear = cnt([/horror/,/jump scare/,/ghost/,/haunt/,/demon/,/possess/,/slasher/,/monster/,/paranormal/,/serial killer/,/supernatural/,/scary/]);
        var action = cnt([/action/,/fight/,/martial/,/chase/,/car chase/,/explosion/,/superhero/,/battle/,/heist/,/gunfight/,/race/]);
        var violence = cnt([/violenc/,/violent/,/gore/,/blood/,/murder/,/brutal/,/torture/,/weapon/,/massacre/,/stab/,/war/,/crime/]);
        var sadness = cnt([/sad/,/grief/,/loss/,/funeral/,/terminal illness/,/crying/,/melanchol/,/depress/,/traged/,/orphan/,/cancer/,/death/]);
        var language = cnt([/profanity/,/strong language/,/f word/,/swear/,/vulgar/,/crude/]);
        var pace = cnt([/fast paced/,/chase/,/race against time/,/time limit/,/escape/,/pursuit/,/heist/,/thriller/]);
        function v(c) { return Math.min(10, Math.round(c * 2.4 * 10) / 10); }
        var mm = { fear: v(fear), action: v(action), violence: v(violence), sadness: v(sadness), language: v(language), pace: v(pace) };
        var moods = [];
        if (mm.fear >= 5) { moods.push({ name: 'Тревожный', pct: Math.min(80, mm.fear * 9) }); moods.push({ name: 'Напряженный', pct: Math.min(70, mm.fear * 8) }); }
        if (hasGenre(genres, /comedy|комедия/i) || cnt([/comedy/,/humor/,/parody/,/satire/,/dark comed/]) >= 1) moods.push({ name: 'Весёлый', pct: 35 });
        if (mm.sadness >= 4) moods.push({ name: 'Грустный', pct: mm.sadness * 6 });
        if (hasGenre(genres, /drama|драма/i)) moods.push({ name: 'Драматический', pct: 25 });
        if (cnt([/mystery/,/detective/,/investigation/,/enigma/,/conspiracy/]) >= 1) moods.push({ name: 'Загадочный', pct: 20 });
        if (cnt([/romance/,/love/,/couple/,/wedding/]) >= 1) moods.push({ name: 'Романтичный', pct: 20 });
        if (cnt([/nostalgia/,/retro/,/childhood/,/vintage/]) >= 1) moods.push({ name: 'Ностальгический', pct: 12 });
        if (hasGenre(genres, /drama|драма/i) || cnt([/philosoph/,/meaning of life/,/introspection/]) >= 1) moods.push({ name: 'Задумчивый', pct: 18 });
        return { mm: mm, moods: moods };
    }

    function lampaLocal(movie) {
        var out = { inFavorite: false, favList: null, viewedPercent: 0 };
        try {
            var id = movie.id || movie.tmdb_id || (movie.movie && (movie.movie.id || movie.movie.tmdb_id));
            if (!id) return out;
            var sid = String(id);
            if (window.Lampa && Lampa.Favorite && typeof Lampa.Favorite.list === 'function') {
                ['scheduled','later','viewed'].forEach(function(n){
                    if (out.inFavorite) return;
                    try {
                        var l = Lampa.Favorite.list(n);
                        if (Object.prototype.toString.call(l) === '[object Array]') {
                            for (var i = 0; i < l.length; i++) {
                                var x = l[i];
                                if (x && String(x.id || x.tmdb_id || '') === sid) { out.inFavorite = true; out.favList = n; break; }
                            }
                        }
                    } catch(e) {}
                });
            }
            if (window.Lampa && Lampa.Timeline && typeof Lampa.Timeline.get === 'function') {
                try {
                    var t = Lampa.Timeline.get(sid);
                    if (!t && !isNaN(Number(sid))) t = Lampa.Timeline.get(Number(sid));
                    if (t) {
                        if (t.duration > 0 && t.time >= 0) out.viewedPercent = Math.min(100, Math.round(100 * t.time / t.duration));
                        else if (typeof t.percent === 'number' && t.percent >= 0) out.viewedPercent = Math.min(100, Math.round(t.percent));
                    }
                } catch(e) {}
            }
        } catch(e) {}
        return out;
    }

    /* ===== АНАЛИЗ ===== */
    function analyze(movie) {
        return Promise.all([loadCredits(movie), loadMeta(movie), Promise.resolve(lampaLocal(movie)), loadKp(movie)]).then(function(arr){
            var credits = arr[0], meta = arr[1], local = arr[2], kp = arr[3];
            var cfg = getSettings();
            var blG = parseBL(cfg.bad_genres), blA = parseBL(cfg.bad_actors), blD = parseBL(cfg.bad_directors);
            var now = new Date().getFullYear();
            var q = (movie.quality || movie.source_quality || '').toString().toUpperCase();
            var rating = parseFloat(movie.vote_average) || 0;
            var votes = parseInt(movie.vote_count) || 0;
            var runtime = parseInt(movie.runtime) || 0;
            var genresRaw = movie.genres || [];
            var genres = genresRaw.map(function(g){ return typeof g === 'string' ? g : (g && g.name) || ''; }).filter(Boolean);
            var ovRu = (movie.overview || '').trim(), ovEn = (meta.enOv || '').trim(), ovBoth = [ovRu, ovEn];
            var yr = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : 0;
            var allRev = meta.reviews.slice();
            var kpUsed = false;
            if (kp && kp.reviews && kp.reviews.length) { allRev = allRev.concat(kp.reviews); kpUsed = true; }
            var rt = reviewStats(allRev); rt.kp = kpUsed;
            var ctx = { kw: meta.kw };
            var dom = readDomSignals();
            var mm, moods;
            if (dom.ok) { mm = dom.mm; moods = dom.moods; } else { var cm = computeMoods(meta.kw, genres); mm = cm.mm; moods = cm.moods; }
            var M = 150, C = 6.1;
            var adj = votes > 0 ? ((votes * rating) + (M * C)) / (votes + M) : 0;
            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){ return c.name; }).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){ return c.job === 'Director'; }).map(function(c){ return c.name; }).filter(Boolean);
            var wrts = crew.filter(function(c){ return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0; }).map(function(c){ return c.name; }).filter(Boolean);
            var isAnim = genreByIdOrName(genresRaw, [GENRE_ID_ANIM], /animation|анимац|мульт|anime|аниме/);
            var hasFamilyGenre = genreByIdOrName(genresRaw, [GENRE_ID_FAMILY, GENRE_ID_KIDS], /family|семейн|kids|детск/);
            var kidsKw = hasKw(ctx, /for kids|children|family-friendly|детям|семейн|для детей|preschool/);

            /* база измерений: теги + русское/англ описание + жанры + ценз + метрики Lampa */
            function dim(kwRe, ovRe) { var k = hasKw(ctx, kwRe); var o = !!ovRe && inAnyText(ovBoth, ovRe); return { k: k, o: o }; }
            var dViol = dim(/violenc|violent|gore|murder|blood|tortur|brutal|weapon|massacre|execution|stab|slaughter|gunfight|shootout|hitman|serial killer|battle/, /убийств|насил|жесток|кров|стрельб|перестрел|взрыв|оружи|резн|террор|бойн/);
            var dDrugs = dim(/drug|meth|coke|cocaine|heroin|marijuan|cannabis|narcotic|addiction|overdose|dealer|cartel|crack|lsd|ecstasy|opium/, /метамфетам|амфетам|наркот|кокаин|героин|марихуан|лсд|экстази|опиум|дилер|картел|зависимост|зелье|травк|варит/);
            var dNud = dim(/nudity|topless|strip club|stripper|full frontal|rear nudity/, /обнаж|нагот|голы|стриптиз/);
            var dSex = dim(/sex scene|sexual content|orgy|prostitut|erotic|one night stand|seduction|affair|infidelity|hooker|threesome/, /эротик|откровен|проститут|интим|секс|постельн|измен|презерватив/);
            var dSmoke = dim(/smoking|cigarette|cigar/, /курени|сигарет|табак/);
            var dAlc = dim(/alcohol|drunkenness|drunk|booze|hangover|beer|wine|vodka|whiskey/, /алкогол|водк|виски|пив|выпив|пьян|похмел/);
            var dProf = dim(/profanity|strong language|swearing|f word|vulgarity/, /нецензур|мат|руган|бран|сквернослов/);
            var dSuic = dim(/suicide|self harm|suicidal/, /суицид|самоубийств|покончи/);
            var dCrime = dim(/criminal|crime|heist|robbery|mafia|gangster|prison|police|detective|thief|outlaw|cartel|drug lord|dea agent/, /криминал|преступ|грабеж|ограблен|мафи|банд|тюрьм|полици|следовател|вор|мошенник|контрабанд/);
            var dPsych = dim(/psychopath|sociopath|serial killer|paranoia|mental illness|schizophren|disturbing|psychological/, /психопат|социопат|маньяк|параной|безуми|шизофрен|психологическ/);
            var dIll = dim(/terminal illness|cancer|disease|hospital|doctor/, /рак|болезн|больниц|диагноз|терапи|инвалид/);
            var dWar = dim(/war|vietnam|world war|soldier|combat|army/, /войн|солдат|боев|арми|фрон/);
            var dDarkCom = hasKw(ctx, /dark comed|black comed|satire|parody|absurd/) || inAnyText(ovBoth, /черн юмор|сатир|пароди|абсурд/);

            var gHorror = hasGenre(genres, /horror|ужас|slasher/i);
            var gWar = hasGenre(genres, /war|военн/i);
            var gCrime = hasGenre(genres, /crime|криминал/i);
            var gThr = hasGenre(genres, /thriller|триллер/i);

            var cViol = (dViol.k?50:0)+(dViol.o?30:0)+((mm.violence||0)>=6?40:((mm.violence||0)>=4?20:0))+(gHorror||gWar?20:(gCrime&&gThr?15:0))+(meta.age!==null&&meta.age>=18?15:(meta.age!==null&&meta.age>=16?10:0));
            var cDrugs = (dDrugs.k?50:0)+(dDrugs.o?30:0)+(gCrime?10:0)+(meta.age!==null&&meta.age>=16?10:0);
            var cSex = (dSex.k?50:0)+(dNud.k?40:0)+(dSex.o?30:0)+(dNud.o?30:0)+(meta.age!==null&&meta.age>=18?15:0);
            var cProf = (dProf.k?50:0)+(dProf.o?30:0)+((mm.language||0)>=5?40:((mm.language||0)>=3?20:0))+(meta.age!==null&&meta.age>=18?10:0);
            var cFear = (gHorror?50:0)+(hasKw(ctx,/horror|scary|haunted|possess|demon|jump scare|ghost/)?30:0)+((mm.fear||0)>=6?40:((mm.fear||0)>=4?20:0))+(gThr?10:0)+(dPsych.k?10:0);
            var cSuic = (dSuic.k?50:0)+(dSuic.o?30:0)+(dIll.k?10:0);
            var cAlc = (dAlc.k?40:0)+(dAlc.o?30:0);
            var cSmoke = (dSmoke.k?40:0)+(dSmoke.o?30:0);
            var cCrime = (dCrime.k?35:0)+(dCrime.o?25:0)+(gCrime?35:0)+(meta.age!==null&&meta.age>=16?15:0);

            /* возраст: TMDB -> KP -> карточка Lampa -> вывод по содержанию */
            var age = meta.age;
            var ageInferred = false;
            if (age === null && kp && kp.age !== null && kp.age !== undefined) age = kp.age;
            if (age === null && dom.age) age = dom.age;
            if (age === null && (cSex >= 30 || cDrugs >= 30 || cViol >= 50)) { age = 16; ageInferred = true; }

            var hardAdult = cViol >= 50 || cDrugs >= 30 || cSex >= 30 || !!movie.adult;
            var familyOK;
            if (isAnim) familyOK = !hardAdult && cSuic < 40 && (age === null || age <= 12) && (hasFamilyGenre || kidsKw || (age !== null && age <= 12));
            else familyOK = !hardAdult && cFear < 40 && cSuic < 40 && rating >= 5 && ((age !== null && age <= 12) || hasFamilyGenre || kidsKw);

            var mG = genres.filter(function(g){ return blG.some(function(b){ return g.toLowerCase().indexOf(b) >= 0; }); });
            var mA = cast.filter(function(a){ return blA.some(function(b){ return a.toLowerCase().indexOf(b) >= 0; }); });
            var mD = [].concat(dirs, wrts).filter(function(p){ return blD.some(function(b){ return p.toLowerCase().indexOf(b) >= 0; }); });
            var F = [], usedG = {};
            function add(src, kind, text, w, group) {
                if (group) { if (usedG[group]) return; usedG[group] = 1; }
                F.push({ src: src, kind: kind, text: text, w: w });
            }

            if (votes >= 3000 && adj >= 8.0) add('card','pro','⭐ Высокий рейтинг ' + rating.toFixed(1) + ' (' + fmtN(votes) + ' оценок)', 30, 'ratehi');
            else if (votes >= 500 && adj >= cfg.min_rating) add('card','pro','⭐ Рейтинг ' + rating.toFixed(1) + ' — выше вашего порога ' + cfg.min_rating.toFixed(1), 20, 'ratehi');
            else if (votes >= 100 && adj >= cfg.min_rating) add('card','pro','⭐ Рейтинг ' + rating.toFixed(1) + ' при ' + fmtN(votes) + ' оценках', 14, 'ratehi');
            if (votes > 0 && votes < 1500 && adj >= 7.6) add('card','pro','🔎 Скрытая жемчужина: высокий рейтинг при малой известности', 12);
            if (votes >= 2000 && adj >= 7.8 && yr > 0 && yr <= now - 5) add('card','pro','🏛 Проверенная временем классика', 12);
            if (yr === now) add('card','pro','🆕 Свежая новинка ' + yr + ' года', 6, 'fresh');
            else if (yr === now - 1) add('card','pro','🔥 Актуальная новинка — все обсуждают', 6, 'fresh');
            if (votes > 0 && votes < 100) add('card','con','❓ Всего ' + votes + ' оценок — рейтинг ненадёжен', 14, 'rateunc');
            if (votes === 0) add('card','con','⚠️ Нет оценок — данных недостаточно', 16, 'rateunc');
            if (votes >= 100 && adj < cfg.min_rating) add('card','con','📉 Может разочаровать: рейтинг ' + rating.toFixed(1) + ' ниже вашего порога', 22, 'ratelow');
            else if (votes >= 50 && rating > 0 && rating < 5) add('card','con','📉 Низкие оценки зрителей (' + rating.toFixed(1) + ')', 26, 'ratelow');
            if (runtime > 0 && runtime <= 95) add('card','pro','🕐 Удобный хронометраж — ' + runtime + ' мин', 7, 'runtime');
            else if (runtime > 180) add('card','con','⌛ Очень длинный (' + runtime + ' мин)', 12, 'runtime');
            else if (runtime > 150) add('card','con','⌛ Довольно длинный (' + runtime + ' мин)', 8, 'runtime');
            if (/CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT|TELESYNC/i.test(q)) add('card','con','📺 Плохое качество изображения и звука (' + q + ')', 26, 'quality');
            else if (/4K|UHD|2160p/i.test(q)) add('card','pro','🎥 Отличное 4K-качество', 10, 'quality');
            else if (q) add('card','pro','🎥 Хорошее качество (' + q + ')', 7, 'quality');

            if (mG.length) add('user','con','⛔ Нелюбимый жанр: ' + mG.join(', '), 40);
            if (mA.length) add('user','con','⛔ Нелюбимый актёр: ' + uniq(mA).slice(0,2).join(', '), 35);
            if (mD.length) add('user','con','⛔ Нелюбимый автор: ' + uniq(mD).slice(0,2).join(', '), 35);

            if (familyOK && isAnim) add('tmdb','pro','🧸 Подходит для детей и семейного просмотра' + (age !== null ? ' (ценз ' + age + '+)' : ''), 16, 'family');
            else if (familyOK) add('tmdb','pro','👨‍‍ Подходит для семейного просмотра' + (age !== null ? ' (ценз ' + age + '+)' : ''), 16, 'family');
            if (age !== null && age >= 18) add('tmdb','con','🔞 Только для взрослых (' + age + '+)', 14, 'age');
            else if (age !== null && age >= 16) add('tmdb','con','🔞 Не для детей (' + age + '+' + (ageInferred ? ', по содержанию' : '') + ')', 12, 'age');
            else if (isAnim && !familyOK) add('tmdb','con','🎭 Анимация для взрослой аудитории', 14, 'age');

            if (cViol >= 50) add('tmdb','con','🔪 Жестокость и кровавые сцены', 16, 'violence');
            if (cDrugs >= 30) add('tmdb','con','💉 Затрагивается тема наркотиков', 14, 'drugs');
            if (cSex >= 30) add('tmdb','con','🫣 Нагота или откровенные сцены', 12, 'sex');
            if (cProf >= 40) add('tmdb','con','🤬 Много нецензурной лексики', 10, 'lang');
            if (cFear >= 40) add('moods','con','😱 Может напугать: много пугающих моментов', 14, 'scare');
            else if ((mm.fear||0) >= 3.5) add('moods','pro','😬 Держит в напряжении до финала', 9, 'tension');
            if (cSuic >= 40) add('tmdb','con','⚠️ Затрагивается тема суицида', 16, 'suic');
            if (cAlc >= 40) add('tmdb','con','🍺 Присутствует алкоголь', 6, 'alc');
            if (cSmoke >= 40) add('tmdb','con','🚬 Показано курение', 5, 'smoke');
            if (cCrime >= 50) add('tmdb','con','⚖️ Тема криминала и беззакония', 8, 'crime');
            if (dPsych.k || dPsych.o) add('tmdb','con','🧠 Тяжёлая психологическая атмосфера', 8, 'psych');
            if (dIll.k || dIll.o) add('tmdb','con','🏥 Тема тяжёлой болезни', 6, 'ill');
            if (dWar.k || dWar.o) add('tmdb','con','🎖 Сцены войны', 8, 'war');
            if (dDarkCom) add('tmdb','pro','🖤 Чёрный юмор и ирония', 8, 'darkcom');
            if (meta.hasTrailer) add('tmdb','pro','▶ Есть трейлер — легко оценить за 2 минуты', 5);
            if (hasGenre(genres, /documentary|документ/i)) add('tmdb','pro','🦉 Документальный — реальные истории', 8);

            if (mm.pace >= 6.5) add('moods','pro','⚡ Динамичный темп — скучать не придётся', 12);
            else if (mm.pace > 0 && mm.pace <= 2.5 && runtime > 120) add('moods','con','🐢 Очень неспешное повествование', 8);
            if (mm.action >= 6) add('moods','pro','💥 Много экшена и зрелища', 12);
            if (mm.sadness >= 6) add('moods','pro','😢 Сильная эмоциональная история — может растрогать', 10, 'sad');
            moods.forEach(function(md){
                var n = (md.name || '').toLowerCase();
                if (/вес[её]л|комедий|юмор/.test(n) && md.pct >= 20) add('moods','pro','😂 Поднимет настроение', 14, 'fun');
                else if (/напряжен/.test(n) && md.pct >= 30) add('moods','pro','🔥 Напряжённый сюжет — не оторваться', 8, 'tension');
                else if (/тревож/.test(n) && md.pct >= 40) add('moods','pro','😰 Тревожная атмосфера — держит в тонусе', 6, 'tension');
                else if (/задумчив|драматич/.test(n) && md.pct >= 25) add('moods','pro','🎭 Заставляет задуматься', 8);
                else if (/романтич/.test(n) && md.pct >= 18) add('moods','pro','❤️ Романтичная история', 8);
                else if (/загадоч/.test(n) && md.pct >= 15) add('moods','pro','🕵️ Загадка и интрига', 8);
                else if (/ностальг/.test(n) && md.pct >= 8) add('moods','pro','🕰 Ностальгическая атмосфера', 6);
                else if (/груст/.test(n) && md.pct >= 20) add('moods','con','😔 Может нагрустить', 6, 'sad');
            });
            if (hasGenre(genres, /comedy|комедия/i) && (mm.sadness || 0) <= 3) add('moods','pro','😂 Лёгкий комедийный тон — поднимет настроение', 10, 'fun');

            var revSrc = rt.kp ? ' (TMDB + Кинопоиск)' : '';
            if (rt.total >= 2 && rt.tone === 'pos') add('reviews','pro','💬 Зрители в восторге' + revSrc + ': ' + rt.pos + ' из ' + rt.total + ' отзывов положительные', 20, 'rev');
            else if (rt.total >= 2 && rt.tone === 'neg') add('reviews','con','💬 Может разочаровать' + revSrc + ': ' + rt.neg + ' из ' + rt.total + ' отзывов отрицательные', 22, 'rev');
            else if (rt.total >= 2 && rt.tone === 'mix') { add('reviews','pro','💬 Отзывы полярные' + revSrc + ': ' + rt.pos + ' из ' + rt.total + ' положительных', 6, 'rev'); add('reviews','con','💬 Часть зрителей осталась недовольна', 8); }

            if (local.inFavorite && local.favList === 'viewed') add('lampa','con','👁 Вы уже смотрели — стоит ли пересматривать?', 8, 'lampa');
            else if (local.inFavorite) add('lampa','pro','🔖 Уже в ваших закладках — вы планировали посмотреть', 8, 'lampa');
            if (local.viewedPercent >= 90) add('lampa','con','👁 Вы уже досмотрели (' + local.viewedPercent + '% просмотра)', 8, 'lampa');
            else if (local.viewedPercent >= 10) add('lampa','con','⏸ Вы бросили просмотр на ' + local.viewedPercent + '% — возможно, не зашло', 12, 'lampa');

            var CAPS = { card: 55, user: 50, tmdb: 45, moods: 40, reviews: 28, lampa: 18 };
            var per = {};
            F.forEach(function(f){ var s = per[f.src] || (per[f.src] = { pro: 0, con: 0 }); s[f.kind] += f.w; });
            var score = 0;
            Object.keys(per).forEach(function(k){
                var cap = CAPS[k] || 40;
                score += Math.min(per[k].pro, cap) - Math.min(per[k].con, cap);
            });
            var metaRich = !!(meta.kw.length || meta.age !== null || meta.reviews.length);
            var activeSrc = 1 + (metaRich ? 1 : 0) + (rt.total >= 2 ? 1 : 0) + (dom.ok || moods.length ? 1 : 0) + (local.inFavorite || local.viewedPercent > 0 ? 1 : 0) + (kpUsed || (kp && kp.age) ? 1 : 0);
            var lowConf = activeSrc <= 2;
            if (lowConf) score = Math.round(score * 0.6);
            if (score > 100) score = 100; if (score < -100) score = -100;
            var norm = Math.round((score + 100) / 2);
            var vClass = score >= 22 ? 'yes' : (score <= -22 ? 'no' : 'maybe');
            var vWord = score >= 22 ? 'СТОИТ' : (score <= -22 ? 'НЕ СТОИТ' : 'СПОРНО');
            var sortF = function(a,b){ return b.w - a.w; };
            var pros = F.filter(function(f){ return f.kind === 'pro'; }).sort(sortF).map(function(f){ return f.text; });
            var cons = F.filter(function(f){ return f.kind === 'con'; }).sort(sortF).map(function(f){ return f.text; });
            if (!pros.length) pros.push('ℹ️ Данных недостаточно для рекомендации');
            if (!cons.length) cons.push((blG.length || blA.length || blD.length) ? '✅ Под ваши фильтры ничего не попало' : '✅ Явных минусов не выявлено');
            var kpStatus = cfg.kp_token ? (kp && kp.status === 'ok' ? 'ok' : 'fail') : 'off';
            return { pros: pros, cons: cons, review: rt, score: score, norm: norm, vClass: vClass, vWord: vWord, mode: (metaRich || kpUsed) ? 'TMDB' : 'TAGS', metaRich: metaRich, kpStatus: kpStatus };
        });
    }

    function restorePrev() {
        var prev = window._sw_prevController; window._sw_prevController = null;
        try { if (prev && prev.name) Lampa.Controller.toggle(prev.name); else Lampa.Controller.toggle('full_start'); }
        catch(e) { try { Lampa.Controller.toggle('full'); } catch(_) {} }
    }
    function clearLoader() { if (window._sw_loaderTimer) { clearInterval(window._sw_loaderTimer); window._sw_loaderTimer = null; } }
    function swKeyCapture(e) {
        if (!window._sw_blocknav) return;
        var ae = document.activeElement;
        if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return;
        if (e.keyCode === 13 || e.keyCode === 32) {
            var a = window._sw_activeInteractive;
            if (a) { e.preventDefault(); try { e.stopImmediatePropagation(); } catch(_) {} $(a).trigger('click'); }
        }
    }
    function cleanupModal() {
        window._sw_rolling = false; window._sw_currentModalHtml = null;
        window._sw_activeInteractive = null;
        clearLoader();
        if (window._sw_keyBound) { document.removeEventListener('keydown', swKeyCapture, true); window._sw_keyBound = false; }
    }
    function registerController() {
        try {
            Lampa.Controller.add('should_watch_modal_enhanced', {
                toggle: function() { var h = window._sw_currentModalHtml; if (h && window._sw_blocknav) highlightVisible(); },
                up: function(){ scrollStep(-1); }, down: function(){ scrollStep(1); },
                left: function(){ moveHorizontal(-1); }, right: function(){ moveHorizontal(1); },
                back: function() {
                    cleanupModal();
                    window._sw_closingFromController = true;
                    try { Lampa.Modal.close(); } catch(e) {}
                    restorePrev();
                }
            });
        } catch(e) { console.error('[SW] registerController:', e); }
    }

    var PIPS = {
        1: [[50,50]],
        2: [[34,34],[66,66]],
        3: [[30,30],[50,50],[70,70]],
        4: [[34,34],[66,34],[34,66],[66,66]],
        5: [[34,34],[66,34],[50,50],[34,66],[66,66]],
        6: [[34,30],[66,30],[34,50],[66,50],[34,70],[66,70]]
    };
    function diceSVG(n) {
        var p = PIPS[n] || PIPS[6], c = '';
        for (var i = 0; i < p.length; i++) c += '<circle cx="' + p[i][0] + '" cy="' + p[i][1] + '" r="9" fill="#17181a"/>';
        return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="88" height="88" rx="22" fill="#b9bdc2" stroke="#71767b" stroke-width="6"/>' + c + '</svg>';
    }
    function rndFace() { return 1 + Math.floor(Math.random() * 6); }

    function buildReadyInner(a) {
        var badges = '<div class="sw-badges">' +
            '<span class="sw-mode-badge"><span class="sw-mode-dot ' + (a.metaRich ? 'active' : 'inactive') + '"></span>TMDB</span>' +
            (a.kpStatus !== 'off' ? '<span class="sw-mode-badge"><span class="sw-mode-dot ' + (a.kpStatus === 'ok' ? 'active' : 'dead') + '"></span>KP</span>' : '') +
            '</div>';
        var quote = '';
        if (a.review.sample && a.review.total >= 2) {
            var toneCls = a.review.tone === 'pos' ? '' : (a.review.tone === 'neg' ? ' neg' : ' mix');
            var txt = a.review.sample.text.length > 240 ? a.review.sample.text.substring(0, 240).trim() + '…' : a.review.sample.text;
            quote = '<div class="sw-quote' + toneCls + '"><div class="sw-quote-text">«' + esc(txt) + '»</div><div class="sw-quote-meta">— ' + esc(a.review.sample.author) + ', отзыв зрителя' + (a.review.kp ? ' (TMDB + Кинопоиск)' : '') + '</div></div>';
        }
        return '' +
            '<div class="sw-dossier">' + badges +
                '<div class="sw-verdict-word ' + a.vClass + '" id="sw-vword">' + esc(a.vWord) + '</div>' +
                '<div class="sw-meter"><div class="sw-meter-fill ' + a.vClass + '" data-w="' + a.norm + '"></div></div>' +
            '</div>' +
            '<button class="sw-dicebtn sw-focusable" id="sw-dice-btn" tabindex="0">' +
                '<span class="sw-label" id="sw-dice-label">Бросить кости</span>' +
                '<span class="sw-dice" id="sw-dice">' + diceSVG(2) + '</span>' +
            '</button>' +
            '<div class="sw-columns">' +
                '<div class="sw-col pros"><div class="sw-title pros">✓ Аргументы за</div><ul class="sw-list">' + a.pros.map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
                '<div class="sw-col cons"><div class="sw-title cons">✗ Аргументы против</div><ul class="sw-list">' + a.cons.map(function(c){ return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>' +
            '</div>' + quote;
    }

    function bindDice(html) {
        var btn = html.find('#sw-dice-btn')[0];
        var dice = html.find('#sw-dice')[0];
        var label = html.find('#sw-dice-label')[0];
        if (!btn || !dice || !label) return;
        dice.addEventListener('animationend', function(){
            try {
                var dist = parseFloat(dice.getAttribute('data-dist') || 0);
                dice.classList.remove('sw-rolling');
                dice.style.transition = 'none';
                dice.style.transform = 'translateX(' + dist + 'px) rotate(720deg)';
                void dice.offsetWidth;
                dice.style.transition = 'transform .6s cubic-bezier(.3,1.3,.4,1)';
                dice.style.transform = 'translateX(0) rotate(0deg)';
                setTimeout(function(){ dice.style.transition = ''; dice.style.transform = ''; }, 650);
            } catch(e) {}
        });
        $(btn).on('hover:enter click keydown', function(e){
            try {
                if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                if (window._sw_rolling) return;
                window._sw_rolling = true;
                var final = Math.random() > 0.5 ? 'СМОТРЕТЬ' : 'НЕ СМОТРЕТЬ';
                label.className = 'sw-label';
                label.textContent = '';
                var dist = Math.max(40, btn.clientWidth - dice.offsetWidth - 32);
                dice.setAttribute('data-dist', dist);
                dice.style.transition = ''; dice.style.transform = '';
                dice.style.setProperty('--sw-dist', dist + 'px');
                dice.classList.remove('sw-rolling');
                void dice.offsetWidth;
                dice.classList.add('sw-rolling');
                var t0 = Date.now(), DUR = 1050, pool = 'СМОТРЕТЬНЕ', frame = 0;
                var iv = setInterval(function(){
                    frame++;
                    var p = Math.min(1, (Date.now() - t0) / DUR);
                    if (frame % 2 === 0) dice.innerHTML = diceSVG(rndFace());
                    if (p < 1) {
                        var reveal = Math.floor(Math.max(0, (p - 0.25) / 0.75) * final.length);
                        var s = final.slice(0, reveal);
                        for (var i = reveal; i < final.length; i++) s += (final[i] === ' ') ? ' ' : pool[Math.floor(Math.random() * pool.length)];
                        label.textContent = s;
                    } else {
                        clearInterval(iv);
                        dice.innerHTML = diceSVG(rndFace());
                        label.textContent = final;
                        label.className = 'sw-label ' + (final === 'СМОТРЕТЬ' ? 'res-yes' : 'res-no');
                        window._sw_rolling = false;
                    }
                }, 45);
            } catch(err) { console.error('[SW] dice:', err); window._sw_rolling = false; }
        });
    }

    function showModal(movie) {
        try {
            var title = esc(movie.title || movie.name || 'Фильм');
            try { window._sw_prevController = Lampa.Controller.enabled ? Lampa.Controller.enabled() : null; } catch(e) { window._sw_prevController = null; }
            var phases = [
                { emoji: '🔍', text: 'Анализирую карточку…' },
                { emoji: '📊', text: 'Тяну данные с TMDB…' },
                { emoji: '🎭', text: 'Читаю настроения фильма…' },
                { emoji: '💬', text: 'Читаю отзывы зрителей…' },
                { emoji: '⚖️', text: 'Взвешиваю аргументы…' }
            ];
            var html = $('<div class="sw-modal-content"><div id="sw-body"><div class="sw-loader"><div class="sw-loader-emoji" id="sw-loader-emoji">' + phases[0].emoji + '</div><div class="sw-loader-text" id="sw-loader-text">' + phases[0].text + '</div><div class="sw-loader-progress"></div></div></div></div>');
            window._sw_currentModalHtml = html; window._sw_activeInteractive = null;

            var pi = 0;
            window._sw_loaderTimer = setInterval(function(){
                pi = (pi + 1) % phases.length;
                var t = html.find('#sw-loader-text'), e = html.find('#sw-loader-emoji');
                if (t.length) { t.css('opacity', 0); setTimeout(function(){ t.text(phases[pi].text).css('opacity', 1); }, 200); }
                if (e.length) setTimeout(function(){ e.text(phases[pi].emoji); }, 150);
            }, 750);

            Lampa.Modal.open({
                title: 'Стоит ли смотреть: ' + title, html: html, size: 'large',
                onBack: function() {
                    var closing = window._sw_closingFromController;
                    cleanupModal();
                    if (closing) { window._sw_closingFromController = false; return; }
                    restorePrev();
                }
            });

            if (window._sw_blocknav && !window._sw_keyBound) {
                document.addEventListener('keydown', swKeyCapture, true);
                window._sw_keyBound = true;
            }

            analyze(movie).then(function(a){
                clearLoader();
                html.find('#sw-body').html('<div class="sw-body">' + buildReadyInner(a) + '</div>');
                bindDice(html);
                setTimeout(function(){
                    html.find('#sw-vword').addClass('appear');
                    html.find('.sw-meter-fill').each(function(){ this.style.width = (this.getAttribute('data-w') || 50) + '%'; });
                    html.find('.sw-list li').each(function(i){ var li = $(this); setTimeout(function(){ li.addClass('appear'); }, i * 40); });
                    if (window._sw_blocknav) highlightVisible();
                }, 100);
                Lampa.Controller.toggle('should_watch_modal_enhanced');
            }).catch(function(err){
                clearLoader(); console.error('[SW] analyze:', err);
                html.find('#sw-body').html('<div class="sw-body" style="text-align:center;padding:48px 20px;color:#e05b56">Не удалось проанализировать фильм. Проверьте сеть и попробуйте снова.</div>');
            });
        } catch(e) { console.error('[SW] showModal:', e); }
    }

    function addBtn(el, movie) {
        try {
            if (!el || !el.length || el.find('.sw-custom-button-enhanced').length) return;
            var btn = $('<div class="full-start__button selector sw-custom-button-enhanced" data-type="should_watch"><div class="full-start__icon">' + ICON + '</div><span>Стоит ли?</span></div>');
            btn.on('hover:enter', function(){ if (movie) showModal(movie); });
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
        try { Lampa.Listener.follow('full', function(e){
            if (e.type !== 'complite') return;
            try {
                var renderEl = null;
                if (e.object && typeof e.object.render === 'function') renderEl = e.object.render();
                else if (e.object && e.object.activity && typeof e.object.activity.render === 'function') renderEl = e.object.activity.render();
                if (renderEl) addBtn(renderEl, e.data.movie);
            } catch(err) { console.error('[SW]', err); }
        }); } catch(e) {}
        try { initSettings(); } catch(e) {}
        try { injectCSS(); } catch(e) {}
        console.log('[ShouldWatch] v19.0 (wide KB, dom age, kp status)');
    }
    try { if (window.appready) startPlugin(); else Lampa.Listener.follow('app', function(e){ if (e.type === 'ready') startPlugin(); }); } catch(e) {}
})();
