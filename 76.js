(function () {
    'use strict';
    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;
    window.should_watch_plugin_enhanced = true;

    var PLUGIN_ID = 'should_watch_plugin_enhanced';
    var SETTINGS_FLAG = 'sw_settings_ready_v47';
    var ICON = '<svg viewBox="0 0 24 24" width="30" height="30" xmlns="http://www.w3.org/2000/svg"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/></svg>';
    var DISPLAY = '"Trebuchet MS","Segoe UI",system-ui,-apple-system,sans-serif';
    var COND = '"Oswald","Roboto Condensed","Arial Narrow",' + DISPLAY;
    var GENRE_ID_ANIM = 16, GENRE_ID_FAMILY = 10751, GENRE_ID_KIDS = 10762;

    var _metaCache = {};
    var _domCache = null;

    window._sw_rolling = false;
    window._sw_currentModalHtml = null;
    window._sw_prevController = null;
    window._sw_closingFromController = false;
    window._sw_loaderTimer = null;
    window._sw_blocknav = false;
    window._sw_activeInteractive = null;
    window._sw_keyBound = false;

    var INTERESTING_TAGS = [
        { re: /based on novel|основан на романе|экранизац/i, text: '✨ Экранизация книги' },
        { re: /based on true story|основан на реальных событиях|true story/i, text: '✨ На реальных событиях' },
        { re: /based on comic|comic book|графическ роман/i, text: '✨ По мотивам комикса' },
        { re: /oscar winner|academy award|лауреат оскар/i, text: '🏆 Лауреат премии Оскар' },
        { re: /cannes|venice|berlin|film festival winner/i, text: '🎬 Призёр кинофестиваля' },
        { re: /cult film|культов/i, text: '🎭 Культовый фильм' },
        { re: /time travel|путешестви[яе] во времени/i, text: '⏳ Путешествия во времени' },
        { re: /heist|ограблен/i, text: '💼 История ограбления' },
        { re: /post[- ]?apocalyptic|постапокалипсис/i, text: '☣️ Постапокалипсис' },
        { re: /dystopia|антиутопи/i, text: '🏙 Антиутопия' },
        { re: /coming of age|взрослен/i, text: '🌱 История взросления' },
        { re: /cyberpunk|киберпанк/i, text: '🤖 Киберпанк' },
        { re: /space|космос|moon|lunar|mars|марс/i, text: '🚀 Космос' },
        { re: /biographical|biopic|биограф/i, text: '📖 Биографическая история' }
    ];
    var FEATURES = [
        { re: /plot twist|twist ending|неожиданн поворот|сюжетн поворот/i, text: '🌀 Неожиданные повороты' },
        { re: /superhero|супергеро/i, text: '🦸 Супергероика' },
        { re: /strong female lead|сильн героин/i, text: '💪 Сильная героиня' },
        { re: /musical|мюзикл/i, text: '🎶 Мюзикл' },
        { re: /magic|маги|волшеб/i, text: '🪄 Магия' },
        { re: /dragon|дракон/i, text: '🐉 Драконы' },
        { re: /detective|детектив/i, text: '🕵️ Детектив' },
        { re: /animal|животн/i, text: '🐾 Милые животные' },
        { re: /кошк|кошач/i, text: '🐱 Котики' },
        { re: /собак|пёс|пес[i]|dog/i, text: '🐶 Собаки' },
        { re: /friendship|дружб/i, text: '🤝 О дружбе' },
        { re: /romance|романтик/i, text: '❤️ Романтика' }
    ];
    var DOM_METRICS = [['pace','Темп'],['fear','Страх'],['action','Экшен'],['violence','Насилие'],['sadness','Грусть'],['language','Лексика']].map(function(p){
        return { key: p[0], re: new RegExp(p[1] + '[\\s\\S]{0,60}?([\\d.,]+)\\s*/\\s*10') };
    });

    function getSetting(k, d) { try { var v = Lampa.Storage.get(PLUGIN_ID + '_' + k); if (v !== undefined && v !== null && v !== '') return v; } catch(e) {} return d; }
    function getSettings() {
        return {
            bad_genres: String(getSetting('bad_genres', '') || ''),
            bad_actors: String(getSetting('bad_actors', '') || ''),
            bad_directors: String(getSetting('bad_directors', '') || ''),
            min_rating: parseFloat(getSetting('min_rating', '6')) || 6,
            font_scale: parseInt(getSetting('font_scale', '20')) || 20
        };
    }
    function parseBL(s) { return s ? s.split(',').map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean) : []; }
    function initSettings() {
        try {
            if (!window.Lampa || !Lampa.SettingsApi || window[SETTINGS_FLAG]) return;
            window[SETTINGS_FLAG] = true;
            Lampa.SettingsApi.addComponent({ component: PLUGIN_ID, name: 'Стоит ли смотреть', icon: ICON });
            [
                { name: 'bad_genres', type: 'input', title: 'Нелюбимые жанры', description: 'Через запятую', default: '' },
                { name: 'bad_actors', type: 'input', title: 'Нелюбимые актёры', description: 'Через запятую', default: '' },
                { name: 'bad_directors', type: 'input', title: 'Нелюбимые авторы', description: 'Через запятую', default: '' },
                { name: 'min_rating', type: 'select', title: 'Минимальный рейтинг', values: {'0':'Любой','5':'5.0','6':'6.0','7':'7.0','8':'8.0'}, default: '6' },
                { name: 'font_scale', type: 'select', title: 'Размер шрифта', values: {'12':'12','14':'14','16':'16','18':'18','20':'20','24':'24','28':'28','32':'32'}, default: '20' },
                { name: 'reset_cache', type: 'select', title: 'Кэш данных', values: {'0':'Хранить','1':'Сбросить при открытии'}, default: '0' }
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
        if (document.getElementById('sw-plugin-styles-enhanced')) return;
        var s = document.createElement('style'); s.id = 'sw-plugin-styles-enhanced';
        s.innerHTML =
            '.sw-custom-button-enhanced{cursor:pointer;transition:background .25s ease,color .25s ease,transform .25s ease}' +
            '.sw-custom-button-enhanced.focus{background:rgba(255,255,255,.18);color:#fff;transform:scale(1.02)}' +
            '.sw-modal-content{padding:28px 32px 48px;color:#e8eaeb;font-family:' + DISPLAY + ';font-size:20px;box-sizing:border-box;max-height:88vh;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-y}' +
            '.sw-modal-content::-webkit-scrollbar{width:5px}.sw-modal-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:10px}' +
            '.sw-body{animation:swFadeIn .5s ease-out}' +
            '@keyframes swFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}' +
            '.sw-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:60px 20px;min-height:45vh;color:#9aa1a6}' +
            '.sw-loader-emoji{font-size:3.2em;line-height:1;animation:swFloat 2.4s ease-in-out infinite}' +
            '@keyframes swFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}' +
            '.sw-loader-text{font-size:1em;font-weight:600;min-height:1.5em;text-align:center;color:#cbd5e1}' +
            '.sw-loader-progress{width:220px;height:3px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;position:relative;margin-top:8px}' +
            '.sw-loader-progress::after{content:"";position:absolute;left:-100%;top:0;height:100%;width:100%;background:linear-gradient(90deg,transparent,#7ec260,transparent);animation:swSlide 1.4s ease-in-out infinite}' +
            '@keyframes swSlide{0%{left:-100%}100%{left:100%}}' +
            '.sw-dossier{position:relative;background:#343839;border-radius:24px;padding:34px 40px;margin-bottom:22px;animation:swRise .55s cubic-bezier(.22,1,.36,1) both}' +
            '@keyframes swRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}' +
            '.sw-badges{position:absolute;top:24px;right:26px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;max-width:55%}' +
            '.sw-mode-badge{display:inline-flex;align-items:center;gap:6px;font-size:.65em;padding:6px 14px;border-radius:20px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:rgba(255,255,255,.06);color:#9aa1a6}' +
            '.sw-mode-dot{width:6px;height:6px;border-radius:50%;display:inline-block}' +
            '.sw-mode-dot.active{background:#7ec260}.sw-mode-dot.inactive{background:#64748b}' +
            '.sw-verdict-word{font-family:' + COND + ';font-size:3em;font-weight:700;letter-spacing:.02em;line-height:1;margin:0 0 24px;text-transform:uppercase;opacity:0;transform:translateY(8px);transition:opacity .6s ease,transform .6s cubic-bezier(.22,1,.36,1)}' +
            '.sw-verdict-word.appear{opacity:1;transform:translateY(0)}' +
            '.sw-verdict-word.yes{color:#2e7d32}.sw-verdict-word.no{color:#a52a2a}.sw-verdict-word.maybe{color:#e0703f}' +
            '.sw-meter{height:3px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}' +
            '.sw-meter-fill{height:100%;width:0;transition:width .9s cubic-bezier(.25,.8,.3,1)}' +
            '.sw-meter-fill.yes{background:#2e7d32}.sw-meter-fill.no{background:#a52a2a}.sw-meter-fill.maybe{background:#e0703f}' +
            '.sw-dicebtn{position:relative;display:block;width:100%;height:110px;background:#9d9fa2;border:none;border-radius:14px;margin:0 0 22px;overflow:hidden;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent;transition:background .3s ease,transform .3s ease}' +
            '.sw-dicebtn.focus{background:#b9bbbe;transform:translateY(-2px)}' +
            '.sw-label-wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 120px;overflow:hidden}' +
            '.sw-label{font-family:' + COND + ';font-size:2em;font-weight:700;color:#43464a;text-transform:lowercase;letter-spacing:.02em;text-align:center;white-space:nowrap;opacity:1;transition:opacity .35s ease}' +
            '.sw-label.hidden{opacity:0}' +
            '.sw-label.res-yes{color:#1b5e20}.sw-label.res-no{color:#b71c1c}' +
            '.sw-dice{position:absolute;left:18px;top:50%;width:64px;height:64px;margin-top:-32px;will-change:transform;transition:left .45s cubic-bezier(.22,1,.36,1),margin-left .45s cubic-bezier(.22,1,.36,1)}' +
            '.sw-dice svg{width:100%;height:100%;display:block;transform:rotate(-8deg)}' +
            '.sw-dicebtn.spinning .sw-dice{left:50%;margin-left:-32px}' +
            '.sw-dice.sw-spin{animation:swSpin .9s cubic-bezier(.4,0,.2,1) forwards}' +
            '@keyframes swSpin{0%{transform:rotate(0) scale(1)}50%{transform:rotate(360deg) scale(1.1)}100%{transform:rotate(720deg) scale(1)}}' +
            '.sw-columns{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}' +
            '.sw-col{position:relative;background:#343839;border-radius:6px;padding:24px 28px 24px calc(13% + 28px);min-height:180px}' +
            '.sw-col::before{content:"";position:absolute;left:0;top:0;bottom:0;width:13%;border-radius:6px 0 0 6px}' +
            '.sw-col.pros::before{background:#4d5f39}.sw-col.cons::before{background:#6d3338}' +
            '.sw-title{font-size:.85em;font-weight:700;margin-bottom:14px;text-transform:lowercase;letter-spacing:.03em}' +
            '.sw-title.pros{color:#8fbf6f}.sw-title.cons{color:#d98a8a}' +
            '.sw-list{margin:0;padding-left:18px;font-size:1.02em;line-height:1.65;color:#c9cdd0}' +
            '.sw-list li{margin-bottom:10px;opacity:0;transform:translateX(-6px);transition:opacity .45s ease,transform .45s cubic-bezier(.22,1,.36,1)}' +
            '.sw-list li.appear{opacity:1;transform:translateX(0)}' +
            '.sw-focusable{outline:none;cursor:pointer}' +
            '@media(max-width:640px){.sw-modal-content{padding:20px 18px 36px}.sw-columns{grid-template-columns:1fr}.sw-col{padding:20px 22px 20px calc(16% + 22px)}.sw-col::before{width:16%}.sw-verdict-word{font-size:2.2em}.sw-label{font-size:1.4em}.sw-label-wrap{padding:0 84px}.sw-dice{width:52px;height:52px;margin-top:-26px;left:14px}.sw-dicebtn.spinning .sw-dice{margin-left:-26px}}';
        document.head.appendChild(s);
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
            if (!r.kw.length) {
                return tmdbGet('/' + type + '/' + id + '/keywords').then(function(d){
                    if (d) (d.keywords || d.results || []).forEach(function(k){ if (k && k.name) r.kw.push(k.name.toLowerCase()); });
                    _metaCache[id] = r; return r;
                });
            }
            _metaCache[id] = r; return r;
        });
    }
    function hasKw(ctx, re) { return ctx.kw.some(function(k){ return re.test(k); }); }
    function reviewStats(reviews) {
        var posRe = /шедевр|великолепн|потрясающ|восхитит|блестящ|лучш|мощн|гениальн|masterpiece|brilliant|amazing|great|best|loved|perfect|outstanding|must-watch|замечательн|превосходн|отличн|весел|смешн|funny|понрав|советую|хорош/i;
        var negRe = /скучн|ужасн|провал|разочаров|слаб|затян|бессмысл|плох|boring|bad|worst|terrible|awful|disappoint|waste|dull|pointless|утомительн|неинтересн/i;
        var pos = 0, neg = 0;
        reviews.forEach(function(r){
            var t = r.text.toLowerCase();
            var p = (t.match(posRe) || []).length, n = (t.match(negRe) || []).length;
            if (p > n) pos++; else if (n > p) neg++;
        });
        var tone = (pos === 0 && neg === 0) ? null : (pos > neg ? 'pos' : (neg > pos ? 'neg' : 'mix'));
        return { total: reviews.length, pos: pos, neg: neg, tone: tone };
    }

    function readDomSignals(key) {
        if (_domCache && _domCache.key === key) return _domCache.data;
        var out = { mm: {}, moods: [], ok: false, age: null, reviews: [] };
        try {
            var txt = document.body.innerText || '';
            var amAll = txt.match(/\b(0|6|12|16|18)\+/g);
            if (amAll) for (var i = 0; i < amAll.length; i++) { var v3 = parseInt(amAll[i], 10); if (!isNaN(v3) && (out.age === null || v3 > out.age)) out.age = v3; }
            var mm = {}, found = 0;
            DOM_METRICS.forEach(function(p){
                var r = txt.match(p.re);
                if (r) { mm[p.key] = parseFloat(r[1].replace(',', '.')); found++; }
            });
            var moods = [];
            var mi = txt.indexOf('Настроения');
            if (mi > -1) {
                var chunk = txt.substring(mi + 10, mi + 1600);
                var re = /(\d{1,3})\s*%\s*\n?\s*([А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z….\-]{2,24})/g, r2;
                while ((r2 = re.exec(chunk)) && moods.length < 12) moods.push({ name: r2[2].trim(), pct: parseInt(r2[1]) });
            }
            if (found >= 3 || moods.length >= 3) { out.mm = mm; out.moods = moods; out.ok = true; }
            var ci = txt.indexOf('Комментарии');
            if (ci > -1) {
                var lines = txt.substring(ci + 11, ci + 6000).split(/\n+/);
                for (var i2 = 0; i2 < lines.length && out.reviews.length < 6; i2++) {
                    var ln = lines[i2].trim();
                    if (!ln) continue;
                    if (/^(Сезон|Режиссёр|Актёры|Производство|Теги|Настроения|Подробно)/.test(ln)) break;
                    if (ln.length >= 40) out.reviews.push({ author: 'зритель', text: ln });
                }
            }
        } catch(e) {}
        _domCache = { key: key, data: out };
        return out;
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

    function findSparkle(meta, credits) {
        var sparks = [];
        var texts = [meta.enOv || ''].concat(meta.kw || []);
        INTERESTING_TAGS.forEach(function(t){
            if (texts.some(function(txt){ return t.re.test(txt || ''); })) sparks.push(t.text);
        });
        if (credits && credits.crew) {
            var dirs = credits.crew.filter(function(c){ return c.job === 'Director'; });
            if (dirs.length === 1 && dirs[0].name) sparks.push('🎬 Режиссёр: ' + dirs[0].name);
        }
        return sparks.slice(0, 2);
    }
    function findFeatures(meta) {
        var feats = [];
        var texts = [meta.enOv || ''].concat(meta.kw || []);
        FEATURES.forEach(function(f){
            if (texts.some(function(txt){ return f.re.test(txt || ''); })) feats.push(f.text);
        });
        return feats.slice(0, 3);
    }

    function analyze(movie) {
        return Promise.all([loadCredits(movie), loadMeta(movie), Promise.resolve(lampaLocal(movie))]).then(function(arr){
            var credits = arr[0], meta = arr[1], local = arr[2];
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
            var dom = readDomSignals(movie.id || movie.tmdb_id || 'x');
            var mm = dom.ok ? dom.mm : {}, moods = dom.ok ? dom.moods : [];
            var domRevs = dom.reviews || [];
            var allRev = meta.reviews.concat(domRevs);
            var rt = reviewStats(allRev);
            var who = domRevs.length ? 'Комментаторы' : 'Зрители';
            var ctx = { kw: meta.kw };
            var M = 150, C = 6.1;
            var adj = votes > 0 ? ((votes * rating) + (M * C)) / (votes + M) : 0;
            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){ return c.name; }).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){ return c.job === 'Director'; }).map(function(c){ return c.name; }).filter(Boolean);
            var wrts = crew.filter(function(c){ return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0; }).map(function(c){ return c.name; }).filter(Boolean);
            var isAnim = genreByIdOrName(genresRaw, [GENRE_ID_ANIM], /animation|анимац|мульт|anime|аниме/);
            var hasFamilyGenre = genreByIdOrName(genresRaw, [GENRE_ID_FAMILY, GENRE_ID_KIDS], /family|семейн|kids|детск/);
            var kidsKw = hasKw(ctx, /for kids|children|family-friendly|детям|семейн|для детей|preschool|toddler|baby|nursery|cartoon for kids|kids tv|educational|animated series|дошкольн|малыш/i);

            var age = dom.age;

            function dim(kwRe, ovRe) { var k = hasKw(ctx, kwRe); var o = !!ovRe && inAnyText(ovBoth, ovRe); return { k: k, o: o }; }
            var dViol = dim(/violenc|violent|gore|murder|blood|tortur|brutal|weapon|massacre|execution|stab|slaughter|gunfight|shootout|hitman|serial killer|battle/, /убийств|насил|жесток|кровь|крови|кровью|кровав|кровопролит|стрельб|перестрел|взрыв|оружи|резн|террор|бойн/);
            var dDrugs = dim(/drug|meth lab|methamphetamine|crystal meth|cocaine|heroin|marijuan|cannabis|narcotic|addiction|overdose|dealer|cartel|crack|lsd|ecstasy|opium/, /метамфетам|амфетам|наркот|кокаин|марихуан|лсд|экстази|опиум|дилер|картел|зависимост|зелье|травк|варит/);
            var dNud = dim(/nudity|topless|strip club|stripper|full frontal|rear nudity/, /обнаж|нагот|голы|стриптиз/);
            var dSex = dim(/sex scene|sexual content|orgy|prostitut|erotic|one night stand|hooker|threesome|explicit/, /эротик|откровенн|проститут|интим|секс|постельн|презерватив/);
            var dSmoke = dim(/smoking|cigarette|cigar/, /курени|сигарет|табак/);
            var dAlc = dim(/alcohol|drunkenness|drunk|booze|hangover|beer|wine|vodka|whiskey/, /алкогол|водк|виски|выпив|пьян|похмел/);
            var dProf = dim(/profanity|strong language|swearing|f word|vulgarity/, /нецензур|сквернослов|матерщин/);
            var dSuic = dim(/suicide|self harm|suicidal/, /суицид|самоубийств|покончи/);
            var dGamb = dim(/gambl|casino|poker|betting|bookmaker|lottery|roulette|slot machine|blackjack/, /азарт|казино|ставк|покер|рулетк|лотере|букмекер/);
            var dCrime = dim(/criminal|crime|heist|robbery|mafia|gangster|prison|police|detective|thief|outlaw|cartel|drug lord|dea agent/, /криминал|преступ|грабеж|ограб|мафи|банд|тюрьм|полици|следовател|мошенник|контрабанд|крад|похищ|вору/);
            var dPsych = dim(/psychopath|sociopath|serial killer|paranoia|mental illness|schizophren|disturbing|psychological/, /психопат|социопат|маньяк|параной|безуми|шизофрен|психологическ/);
            var dIll = dim(/terminal illness|cancer|chemotherapy|leukemia|leukaemia|tumor|tumour|alzheimer|parkinson|aids|brain tumor|lung cancer|incurable/, /онколог|злокачествен|химиотерап|лейкеми|неизлечим|терминальн|альцгеймер|паркинсон|рак лёгких|рак мозга|опухол/);
            var dWar = dim(/war|vietnam|world war|soldier|combat|army/, /военн|фрон|солдат|арми|боев|войск/);
            var dChild = dim(/child abuse|abused child|child neglect|cruelty to children|child cruelty|abusive parent|child violence|pedophile|pedophilia/, /насилие над детьми|жестокое обращение с детьми|издевается над детьми|избивает детей|абьюз детей|педофил/);
            var dDarkCom = hasKw(ctx, /dark comed|black comed|satire|parody|absurd/) || inAnyText(ovBoth, /черн юмор|сатир|пароди|абсурд/);

            if (age !== null && age <= 12) { dSex.o = false; dNud.o = false; }

            var gHorror = hasGenre(genres, /horror|ужас|slasher/i);
            var gWar = hasGenre(genres, /war|военн/i);
            var gCrime = hasGenre(genres, /crime|криминал/i);
            var gThr = hasGenre(genres, /thriller|триллер/i);

            var cViol = (dViol.k?50:0)+(dViol.o?30:0)+((mm.violence||0)>=6?40:((mm.violence||0)>=4?20:0))+(gHorror||gWar?20:(gCrime&&gThr?15:0))+(age!==null&&age>=18?15:(age!==null&&age>=16?10:0));
            var cDrugs = (dDrugs.k?50:0)+(dDrugs.o?30:0)+(gCrime?10:0)+(age!==null&&age>=16?10:0);
            var cSex = (dSex.k?50:0)+(dNud.k?40:0)+(dSex.o?30:0)+(dNud.o?30:0)+(age!==null&&age>=18?15:0);
            var cProf = (dProf.k?50:0)+(dProf.o?30:0)+((mm.language||0)>=5?40:((mm.language||0)>=3?20:0))+(age!==null&&age>=18?10:0);
            var cFear = (gHorror?50:0)+(hasKw(ctx,/horror|scary|haunted|possess|demon|jump scare|ghost/)?30:0)+((mm.fear||0)>=6?40:((mm.fear||0)>=4?20:0))+(gThr?10:0)+(dPsych.k?10:0);
            var cSuic = (dSuic.k?50:0)+(dSuic.o?30:0)+(dIll.k?10:0);
            var cAlc = (dAlc.k?40:0)+(dAlc.o?30:0);
            var cSmoke = (dSmoke.k?40:0)+(dSmoke.o?30:0);
            var cGamb = (dGamb.k?50:0)+(dGamb.o?30:0);
            var cCrime = (dCrime.k?35:0)+(dCrime.o?25:0)+(gCrime?35:0)+(age!==null&&age>=16?15:0);
            var cChild = (dChild.k?60:0)+(dChild.o?40:0);

            var hardAdult = cViol >= 50 || cDrugs >= 30 || cSex >= 30 || cChild >= 50 || !!movie.adult;
            var familyOK;
            if (isAnim) {
                if (age !== null && age <= 6) familyOK = !hardAdult;
                else if (age !== null && age <= 12) familyOK = !hardAdult && cSuic < 40 && cFear < 40 && cViol < 30;
                else if (age !== null && age >= 16) familyOK = false;
                else familyOK = !hardAdult && cSuic < 40 && cProf < 40 && (hasFamilyGenre || kidsKw);
            } else {
                familyOK = !hardAdult && cFear < 40 && cSuic < 40 && rating >= 5 && ((age !== null && age <= 12) || hasFamilyGenre || kidsKw);
            }

            var mG = genres.filter(function(g){ return blG.some(function(b){ return g.toLowerCase().indexOf(b) >= 0; }); });
            var mA = cast.filter(function(a){ return blA.some(function(b){ return a.toLowerCase().indexOf(b) >= 0; }); });
            var mD = [].concat(dirs, wrts).filter(function(p){ return blD.some(function(b){ return p.toLowerCase().indexOf(b) >= 0; }); });

            var F = [], usedG = {};
            function add(src, kind, text, w, group) {
                if (group) { if (usedG[group]) return; usedG[group] = 1; }
                F.push({ src: src, kind: kind, text: text, w: w });
            }

            findSparkle(meta, credits).forEach(function(s){ add('sparkle','pro',s,25); });
            findFeatures(meta).forEach(function(t,i){ add('sparkle','pro',t,10,'feat'+i); });

            if (votes >= 3000 && adj >= 8.0) add('card','pro','✨ Высокий рейтинг: ' + rating.toFixed(1) + ' (' + fmtN(votes) + ' голосов)', 30, 'ratehi');
            else if (votes >= 500 && adj >= cfg.min_rating) add('card','pro','✨ Хороший рейтинг: ' + rating.toFixed(1) + ' (' + fmtN(votes) + ' голосов)', 20, 'ratehi');
            else if (votes >= 100 && adj >= cfg.min_rating) add('card','pro','✨ Достойный рейтинг: ' + rating.toFixed(1) + ' (' + fmtN(votes) + ' голосов)', 14, 'ratehi');
            if (votes > 0 && votes < 1500 && adj >= 7.6) add('card','pro','🔍 Скрытая жемчужина', 12);
            if (votes >= 2000 && adj >= 7.8 && yr > 0 && yr <= now - 5) add('card','pro','🏛 Культурное наследие', 12);
            if (yr === now) add('card','pro','🆕 Новинка ' + yr + ' года', 6, 'fresh');
            if (votes > 0 && votes < 100) add('card','con','❓ Мало оценок (' + votes + ')', 14, 'rateunc');
            if (votes === 0) add('card','con','⚠️ Нет оценок', 16, 'rateunc');
            if (votes >= 100 && adj < cfg.min_rating) add('card','con','📉 Рейтинг ниже порога: ' + rating.toFixed(1), 22, 'ratelow');
            else if (votes >= 50 && rating > 0 && rating < 5) add('card','con','📉 Низкий рейтинг: ' + rating.toFixed(1), 26, 'ratelow');
            if (runtime > 0 && runtime <= 95) add('card','pro','⏱ Короткометражка: ' + runtime + ' мин', 7, 'runtime');
            else if (runtime > 150) add('card','con','⌛ Длинный фильм: ' + runtime + ' мин', 12, 'runtime');
            if (/CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT|TELESYNC/i.test(q)) add('card','con','📺 Плохое качество', 26, 'quality');
            else if (/4K|UHD|2160p/i.test(q)) add('card','pro','🎥 4K', 10, 'quality');
            else if (q) add('card','pro','🎥 Высокое качество', 7, 'quality');

            if (mG.length) add('user','con','⛔ Нелюбимые жанры: ' + mG.join(', '), 40);
            if (mA.length) add('user','con','⛔ Нелюбимые актёры: ' + uniq(mA).slice(0,2).join(', '), 35);
            if (mD.length) add('user','con','⛔ Нелюбимые авторы: ' + uniq(mD).slice(0,2).join(', '), 35);

            if (familyOK && isAnim) add('tmdb','pro','🧸 Детский' + (age !== null ? ' (' + age + '+)' : ''), 16, 'family');
            else if (familyOK) add('tmdb','pro','👨‍‍ Семейный' + (age !== null ? ' (' + age + '+)' : ''), 16, 'family');
            if (age !== null && age >= 18) add('tmdb','con','🔞 Для взрослых (18+)', 14, 'age');
            else if (age !== null && age >= 16) add('tmdb','con','🔞 Ограничение 16+', 12, 'age');
            if (isAnim && !familyOK) add('tmdb','con','🎭 Взрослая анимация' + (age !== null ? ' (' + age + '+)' : ''), 14, 'adultanim');

            if (cViol >= 50) add('tmdb','con','🔪 Сцены насилия', 16, 'violence');
            if (cDrugs >= 30) add('tmdb','con','💉 Упоминание наркотиков', 14, 'drugs');
            if (cSex >= 30) add('tmdb','con','🫣 Сцены секса и обнажёнки', 12, 'sex');
            if (cProf >= 40) add('tmdb','con','🤬 Нецензурная лексика', 10, 'lang');
            if (cFear >= 40) add('moods','con','😱 Страшно', 14, 'scare');
            else if ((mm.fear||0) >= 3.5) add('moods','pro','😬 Напряжённый сюжет', 9, 'tension');
            if (cSuic >= 40) add('tmdb','con','⚠️ Тема суицида', 16, 'suic');
            if (cAlc >= 40) add('tmdb','con','🍺 Употребление алкоголя', 6, 'alc');
            if (cSmoke >= 40) add('tmdb','con','🚬 Курение', 5, 'smoke');
            if (cGamb >= 40) add('tmdb','con','🎰 Азартные игры', 10, 'gamb');
            if (cCrime >= 50) add('tmdb','con','⚖️ Криминальная тематика', 8, 'crime');
            if (dPsych.k || dPsych.o) add('tmdb','con','🧠 Тяжёлая атмосфера', 8, 'psych');
            if (dIll.k || dIll.o) add('tmdb','con','🏥 Тема болезни', 6, 'ill');
            if (dWar.k || dWar.o) add('tmdb','con','🎖 Война', 8, 'war');
            if (cChild >= 50) add('tmdb','con','🚸 Насилие над детьми', 18, 'childabuse');
            if (dDarkCom) add('tmdb','pro','🖤 Чёрный юмор', 8, 'darkcom');
            if (meta.hasTrailer) add('tmdb','pro','▶ Есть трейлер', 5);
            if (hasGenre(genres, /documentary|документ/i)) add('tmdb','pro','🦉 Документальный', 8);

            if (mm.pace >= 6.5) add('moods','pro','⚡ Динамичный', 12);
            else if (mm.pace > 0 && mm.pace <= 2.5 && runtime > 120) add('moods','con','🐢 Медленный темп', 8);
            if (mm.action >= 6) add('moods','pro','💥 Экшен', 12);
            if (mm.sadness >= 6) add('moods','pro','😢 Трогательный', 10, 'sad');
            moods.forEach(function(md){
                var n = (md.name || '').toLowerCase();
                if (/вес[её]л|комедий|юмор/.test(n) && md.pct >= 20) add('moods','pro','😂 Развеселит', 14, 'fun');
                else if (/напряжен/.test(n) && md.pct >= 30) add('moods','pro','🔥 Напряжённый', 8, 'tension');
                else if (/тревож/.test(n) && md.pct >= 40) add('moods','pro','😰 Тревожный', 6, 'anxiety');
                else if (/задумчив|драматич/.test(n) && md.pct >= 25) add('moods','pro','🎭 Глубокий', 8);
                else if (/романтич/.test(n) && md.pct >= 18) add('moods','pro','❤️ Романтичный', 8);
                else if (/загадоч/.test(n) && md.pct >= 15) add('moods','pro','🕵️ Загадочный', 8);
                else if (/ностальг/.test(n) && md.pct >= 8) add('moods','pro','🕰 Ностальгический', 6);
                else if (/груст/.test(n) && md.pct >= 20) add('moods','con','😔 Не для ранимых', 6, 'sad');
            });
            if (hasGenre(genres, /comedy|комедия/i) && (mm.sadness || 0) <= 3) add('moods','pro','😂 Комедия', 10, 'fun');

            if (rt.total >= 2 && rt.tone === 'pos') add('reviews','pro','💬 ' + who + ' в восторге', 20, 'rev');
            else if (rt.total >= 2 && rt.tone === 'neg') add('reviews','con','💬 ' + who + ' разочарованы', 22, 'rev');
            else if (rt.total >= 2 && rt.tone === 'mix') add('reviews','pro','💬 Мнения разделились', 10, 'rev');

            if (local.inFavorite && local.favList === 'viewed') add('lampa','con','👁 Уже смотрели', 8, 'lampa');
            else if (local.inFavorite) add('lampa','pro','🔖 В закладках', 8, 'lampa');
            if (local.viewedPercent >= 90) add('lampa','con','👁 Досмотрено на ' + local.viewedPercent + '%', 8, 'lampa');
            else if (local.viewedPercent >= 10) add('lampa','con','⏸ Брошено на ' + local.viewedPercent + '%', 12, 'lampa');

            var CAPS = { card: 55, user: 50, tmdb: 45, moods: 40, reviews: 28, lampa: 18, sparkle: 60 };
            var per = {};
            F.forEach(function(f){ var s = per[f.src] || (per[f.src] = { pro: 0, con: 0 }); s[f.kind] += f.w; });
            var score = 0;
            Object.keys(per).forEach(function(k){
                var cap = CAPS[k] || 40;
                score += Math.min(per[k].pro, cap) - Math.min(per[k].con, cap);
            });
            var metaRich = !!(meta.kw.length || meta.reviews.length);
            var activeSrc = 1 + (metaRich ? 1 : 0) + (rt.total >= 2 ? 1 : 0) + (dom.ok || moods.length ? 1 : 0) + (local.inFavorite || local.viewedPercent > 0 ? 1 : 0);
            var lowConf = activeSrc <= 2;
            if (lowConf) score = Math.round(score * 0.6);
            if (score > 100) score = 100; if (score < -100) score = -100;
            var norm = Math.round((score + 100) / 2);
            var vClass = score >= 22 ? 'yes' : (score <= -22 ? 'no' : 'maybe');
            var vWord = score >= 22 ? 'СТОИТ' : (score <= -22 ? 'НЕ СТОИТ' : 'СПОРНО');
            var sortF = function(a,b){ return b.w - a.w; };
            var pros = F.filter(function(f){ return f.kind === 'pro'; }).sort(sortF).map(function(f){ return f.text; });
            var cons = F.filter(function(f){ return f.kind === 'con'; }).sort(sortF).map(function(f){ return f.text; });
            if (!pros.length) pros.push('ℹ️ Нет данных');
            if (!cons.length) cons.push((blG.length || blA.length || blD.length) ? '✅ Фильтры чисты' : '✅ Минусов нет');
            return { pros: pros, cons: cons, review: rt, score: score, norm: norm, vClass: vClass, vWord: vWord, mode: metaRich ? 'TMDB' : 'TAGS', metaRich: metaRich };
        });
    }

    function restorePrev() {
        var prev = window._sw_prevController; window._sw_prevController = null;
        try { if (prev && prev.name) Lampa.Controller.toggle(prev.name); else Lampa.Controller.toggle('full'); }
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
        1: [[50,50]], 2: [[34,34],[66,66]], 3: [[30,30],[50,50],[70,70]],
        4: [[34,34],[66,34],[34,66],[66,66]], 5: [[34,34],[66,34],[50,50],[34,66],[66,66]],
        6: [[34,30],[66,30],[34,50],[66,50],[34,70],[66,70]]
    };
    function diceSVG(n) {
        var p = PIPS[n] || PIPS[6], c = '';
        for (var i = 0; i < p.length; i++) c += '<circle cx="' + p[i][0] + '" cy="' + p[i][1] + '" r="9" fill="#c62828"/>';
        return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="88" height="88" rx="22" fill="#fafafa" stroke="#cfd2d5" stroke-width="5"/>' + c + '</svg>';
    }
    function rndFace() { return 1 + Math.floor(Math.random() * 6); }

    function buildReadyInner(a) {
        var badges = '<div class="sw-badges"><span class="sw-mode-badge"><span class="sw-mode-dot ' + (a.metaRich ? 'active' : 'inactive') + '"></span>TMDB</span></div>';
        return '<div class="sw-dossier">' + badges +
            '<div class="sw-verdict-word ' + a.vClass + '" id="sw-vword">' + esc(a.vWord) + '</div>' +
            '<div class="sw-meter"><div class="sw-meter-fill ' + a.vClass + '" data-w="' + a.norm + '"></div></div></div>' +
            '<button class="sw-dicebtn sw-focusable" id="sw-dice-btn" tabindex="0">' +
            '<span class="sw-label-wrap"><span class="sw-label" id="sw-dice-label">бросить кубик</span></span>' +
            '<span class="sw-dice" id="sw-dice">' + diceSVG(1) + '</span></button>' +
            '<div class="sw-columns">' +
            '<div class="sw-col pros"><div class="sw-title pros">✓ аргументы за</div><ul class="sw-list">' + a.pros.map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
            '<div class="sw-col cons"><div class="sw-title cons">✗ аргументы против</div><ul class="sw-list">' + a.cons.map(function(c){ return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div></div>';
    }

    function bindDice(html) {
        var btn = html.find('#sw-dice-btn')[0];
        var btnJ = html.find('#sw-dice-btn');
        var dice = html.find('#sw-dice')[0];
        var label = html.find('#sw-dice-label')[0];
        if (!btn || !dice || !label) return;
        $(btn).on('hover:enter click keydown', function(e){
            if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
            if (window._sw_rolling) return;
            window._sw_rolling = true;
            var final = Math.random() > 0.5 ? 'смотреть' : 'не смотреть';
            label.classList.add('hidden');
            btnJ.addClass('spinning');
            setTimeout(function(){
                dice.classList.add('sw-spin');
                var iv = setInterval(function(){ dice.innerHTML = diceSVG(rndFace()); }, 90);
                setTimeout(function(){
                    clearInterval(iv);
                    dice.classList.remove('sw-spin');
                    dice.innerHTML = diceSVG(rndFace());
                    btnJ.removeClass('spinning');
                    setTimeout(function(){
                        label.textContent = final;
                        label.className = 'sw-label ' + (final === 'смотреть' ? 'res-yes' : 'res-no');
                        window._sw_rolling = false;
                    }, 300);
                }, 900);
            }, 450);
        });
    }

    function showModal(movie) {
        try {
            try {
                if (getSetting('reset_cache', '0') === '1') {
                    _metaCache = {}; _domCache = null;
                    Lampa.Storage.set(PLUGIN_ID + '_reset_cache', '0');
                }
            } catch(e) {}

            var cfg = getSettings();
            var title = esc(movie.title || movie.name || 'Фильм');
            try { window._sw_prevController = Lampa.Controller.enabled ? Lampa.Controller.enabled() : null; } catch(e) { window._sw_prevController = null; }
            var phases = ['Анализирую…','TMDB…','Настроения…','Комментарии…','Взвешиваю…'];
            var html = $('<div class="sw-modal-content"><div id="sw-body"><div class="sw-loader"><div class="sw-loader-emoji" id="sw-loader-emoji">🔍</div><div class="sw-loader-text" id="sw-loader-text">' + phases[0] + '</div><div class="sw-loader-progress"></div></div></div></div>');
            html.css('font-size', cfg.font_scale + 'px');
            window._sw_currentModalHtml = html; window._sw_activeInteractive = null;

            var pi = 0;
            window._sw_loaderTimer = setInterval(function(){
                pi = (pi + 1) % phases.length;
                var t = html.find('#sw-loader-text');
                if (t.length) t.text(phases[pi]);
            }, 700);

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
                html.find('#sw-body').html('<div class="sw-body" style="text-align:center;padding:48px 20px;color:#a52a2a">Ошибка анализа</div>');
            });
        } catch(e) { console.error('[SW] showModal:', e); }
    }

    function addBtn(el, movie) {
        try {
            if (!el || !el.length || el.find('.sw-custom-button-enhanced').length) return;
            var btn = $('<div class="full-start__button selector sw-custom-button-enhanced" data-type="should_watch"><div class="full-start__icon">' + ICON + '</div><span>Стоит ли</span></div>');
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
                if (renderEl && e.data && e.data.movie) addBtn(renderEl, e.data.movie);
            } catch(err) { console.error('[SW]', err); }
        }); } catch(e) {}
        try { initSettings(); } catch(e) {}
        try { injectCSS(); } catch(e) {}
        console.log('[ShouldWatch] v47.0 (user design)');
    }

    try { if (window.appready) startPlugin(); else Lampa.Listener.follow('app', function(e){ if (e.type === 'ready') startPlugin(); }); } catch(e) {}
})();
