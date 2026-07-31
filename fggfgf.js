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
    var _metaCache = {};

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
            Lampa.SettingsApi.addComponent({ component: PLUGIN_ID, name: 'Досье: Стоит смотреть?', icon: ICON });
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
                '.sw-focusable.focus{box-shadow:0 0 0 3px rgba(255,255,255,.92),0 0 24px rgba(255,255,255,.22);transition:box-shadow .15s ease; transform: scale(1.02); z-index: 2; position: relative}' +
                '.sw-btn-close{margin-top:20px; text-align:center; padding: 15px; background: rgba(255,255,255,0.1); border-radius: 12px; cursor: pointer; font-weight: bold}' +
                '.sw-btn-close.focus{background: rgba(255,255,255,0.2); box-shadow: 0 0 0 2px #fff}' +
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
                '.sw-columns{display:flex;justify-content:space-between;gap:18px;margin-bottom:20px}' +
                '.sw-col{flex:1;background:rgba(255,255,255,.04);padding:15px 17px;border-radius:12px;border:1px solid rgba(255,255,255,.06);}' +
                '.sw-title{font-family:' + DISPLAY + ';font-size:1.02em;font-weight:800;margin-bottom:13px;text-transform:uppercase;display:flex;align-items:center;gap:8px;letter-spacing:.03em}' +
                '.sw-title.pros{color:#85c25e}.sw-title.cons{color:#d9534f}.sw-title.target{color:#e0e0e0}' +
                '.sw-list{margin:0;padding-left:18px;font-size:.96em;line-height:1.5;color:#cdd3db}.sw-list li{margin-bottom:9px}' +
                '.sw-target-audience{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);padding:16px 18px;border-radius:12px;line-height:1.6;color:#d6dce4;font-size:1.02em;margin-bottom:20px}' +
                '@keyframes swFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}' +
                '@keyframes swRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}' +
                '@keyframes swBounce{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-14px) rotate(6deg)}}' +
                '@keyframes swSlide{0%{left:-40%}100%{left:100%}}' +
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

    /* ===== TV CONTROLLER & FOCUS ===== */
    function swSetFocus(i) {
        try {
            var h = window._sw_currentModalHtml; if (!h) return;
            var blocks = h.find('.sw-focusable'); if (!blocks.length) return;
            if (i < 0) i = 0; if (i >= blocks.length) i = blocks.length - 1;
            window._sw_focusIdx = i;
            blocks.removeClass('focus');
            var el = blocks.eq(i);
            el.addClass('focus');
            
            try { el[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) {}
            setTimeout(function() {
                try {
                    var container = h[0];
                    var elTop = el[0].offsetTop;
                    var elHeight = el[0].offsetHeight;
                    var containerHeight = container.clientHeight;
                    var currentScroll = container.scrollTop;
                    if (elTop < currentScroll + 20) {
                        container.scrollTop = elTop - 20;
                    } else if (elTop + elHeight > currentScroll + containerHeight - 20) {
                        container.scrollTop = elTop + elHeight - containerHeight + 20;
                    }
                } catch(err) {}
            }, 100);
        } catch(e) { console.error('[SW] setFocus:', e); }
    }

    // Регистрация кастомного контроллера для навигации пультом
    Lampa.Controller.add(PLUGIN_ID, {
        toggle: function () {
            Lampa.Controller.reset();
            Lampa.Controller.collectionSet($('.sw-modal-content'));
            swSetFocus(window._sw_focusIdx || 0);
        },
        up: function () {
            if (window._sw_focusIdx > 0) {
                swSetFocus(window._sw_focusIdx - 1);
            } else {
                var el = $('.sw-modal-content')[0];
                if (el) el.scrollTop -= 100;
            }
        },
        down: function () {
            var blocks = $('.sw-modal-content .sw-focusable');
            if (window._sw_focusIdx < blocks.length - 1) {
                swSetFocus(window._sw_focusIdx + 1);
            } else {
                var el = $('.sw-modal-content')[0];
                if (el) el.scrollTop += 100;
            }
        },
        left: function () {},
        right: function () {},
        back: function () { 
            window._sw_closingFromController = true;
            try { Lampa.Modal.close(); } catch(e) {}
            restorePrev(); 
        }
    });

    function restorePrev() {
        var prev = window._sw_prevController; window._sw_prevController = null;
        window._sw_currentModalHtml = null;
        window._sw_focusIdx = 0;
        try { if (prev && prev.name) Lampa.Controller.toggle(prev.name); else Lampa.Controller.toggle('full_start'); }
        catch(e) { try { Lampa.Controller.toggle('full'); } catch(_) {} }
    }

    /* ===== ДОГРУЗКА ДАННЫХ TMDB ===== */
    function loadCredits(movie) {
        try {
            if (movie.credits && ((movie.credits.cast && movie.credits.cast.length) || (movie.credits.crew && movie.credits.crew.length))) return Promise.resolve(movie.credits);
            var id = movie.id || movie.tmdb_id; if (!id) return Promise.resolve(null);
            if (Lampa.TMDB && typeof Lampa.TMDB.credits === 'function') {
                return new Promise(function(res) { Lampa.TMDB.credits(id, function(d){ res(d && !d.status_code ? d : null); }, function(){ res(null); }); });
            }
        } catch(e) {}
        return Promise.resolve(null);
    }
    function tmdbKey() { try { if (Lampa.TMDB && Lampa.TMDB.key) return Lampa.TMDB.key; } catch(e) {} return '4ef0d7355d9ffb5151e987764708ce96'; }
    function tmdbGet(path) {
        return new Promise(function(res) {
            try {
                if (typeof fetch === 'undefined') return res(null);
                fetch('https://api.themoviedb.org/3' + path + '&api_key=' + tmdbKey())
                    .then(function(r){ return r.json(); })
                    .then(function(d){ res(d && d.status_code ? null : d); })
                    .catch(function(){ res(null); });
            } catch(e) { res(null); }
        });
    }
    function mapUSRating(s) { return { 'G':0, 'PG':7, 'PG-13':13, 'R':16, 'NC-17':17, 'TV-MA':17, 'TV-14':14, 'MA':17 }[(s || '').toUpperCase()] || null; }
    function loadMeta(movie) {
        var id = movie.id || movie.tmdb_id; if (!id) return Promise.resolve({ kw: [], age: null, reviews: [], hasTrailer: false, enOv: '' });
        if (_metaCache[id]) return Promise.resolve(_metaCache[id]);
        var type = mediaType(movie);
        return Promise.all([
            tmdbGet('/' + type + '/' + id + '/keywords?'),
            tmdbGet('/' + type + '/' + id + '/content_ratings?'),
            tmdbGet('/' + type + '/' + id + '/reviews?'),
            tmdbGet('/' + type + '/' + id + '/videos?'),
            tmdbGet('/' + type + '/' + id + '?language=en-US')
        ]).then(function(arr) {
            var kw = [];
            if (arr[0]) (arr[0].keywords || arr[0].results || []).forEach(function(k){ if (k && k.name) kw.push(k.name.toLowerCase()); });
            var age = null;
            if (arr[1] && arr[1].results) {
                var ru = arr[1].results.find(function(x){ return x.iso_3166_1 === 'RU'; });
                var us = arr[1].results.find(function(x){ return x.iso_3166_1 === 'US'; });
                if (ru && ru.rating) { var n = parseInt(ru.rating); if (!isNaN(n)) age = n; }
                if (age === null && us && us.rating) age = mapUSRating(us.rating);
            }
            var reviews = [];
            if (arr[2] && arr[2].results) reviews = arr[2].results.slice(0, 5).map(function(r){ return { author: r.author || 'Аноним', text: (r.content || '').replace(/<[^>]+>/g, '').trim() }; }).filter(function(r){ return r.text.length > 20; });
            var hasTrailer = false;
            if (arr[3] && arr[3].results) hasTrailer = arr[3].results.some(function(v){ return v.type === 'Trailer' && v.site === 'YouTube'; });
            var enOv = (arr[4] && arr[4].overview) ? arr[4].overview : '';
            var r = { kw: kw, age: age, reviews: reviews, hasTrailer: hasTrailer, enOv: enOv }; _metaCache[id] = r; return r;
        });
    }
    function hasKw(ctx, re) { return ctx.kw.some(function(k){ return re.test(k); }); }

    function buildAudience(pros, cons, genres, rating, familyOK) {
        var str = pros.join(' ') + ' ' + cons.join(' ');
        var hasCult = str.indexOf('культ') >= 0;
        var hasAction = str.indexOf('экшен') >= 0 || str.indexOf('драйв') >= 0;
        var hasDoc = str.indexOf('познавательно') >= 0;
        var hasMixed = str.indexOf('полярные') >= 0;
        var hasViolence = str.indexOf('жесток') >= 0;
        var hasDrugs = str.indexOf('наркотиков') >= 0;
        
        var hasThriller = hasGenre(genres, /thriller|horror|триллер|ужас/i);
        var hasComedy = hasGenre(genres, /comedy|комед/i);
        var hasDrama = hasGenre(genres, /drama|драма/i);
        var hasSciFi = hasGenre(genres, /sci-fi|fantasy|фантастик/i);

        var parts = [];
        if (hasCult && rating >= 8) parts.push('тем, кто ценит проверенную временем классику');
        else if (hasAction) parts.push('ищущим драйв и непрерывный экшен');
        else if (hasThriller) parts.push('любителям пощекотать нервы');
        else if (hasComedy) parts.push('желающим расслабиться и посмеяться');
        else if (hasDrama && rating >= 7) parts.push('зрителям, готовым к сильной эмоциональной истории');
        else if (hasSciFi) parts.push('фанатам глубокого погружения в другие миры');
        else if (hasDoc) parts.push('людям с исследовательским интересом');
        else if (hasMixed) parts.push('любителям спорного и нестандартного кино');

        if (familyOK) return 'Семьям для спокойного совместного вечера (чистый контент).';
        if (parts.length === 0) return 'Универсальный профиль, без специфических требований.';

        var base = 'Идеально подойдет ' + parts[0];
        if (hasViolence && hasDrugs) base += ', но требует устойчивости к маргинальным темам и насилию.';
        else if (hasViolence) base += ', но готовьтесь к жестоким сценам.';
        else if (hasDrugs) base += ', но присутствует тема зависимости/веществ.';
        return base + '.';
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
            var genres = (movie.genres || []).map(function(g){ return g.name; }).filter(Boolean);
            var ovRu = (movie.overview || '').trim();
            var ovEn = (meta.enOv || '').trim();
            var ovBoth = [ovRu, ovEn];
            var age = meta.age, yr = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : 0;
            var dataRich = !!(meta.kw.length || age !== null || meta.reviews.length || (credits && credits.crew && credits.crew.length));

            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){ return c.name; }).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){ return c.job === 'Director'; }).map(function(c){ return c.name; }).filter(Boolean);
            var wrts = crew.filter(function(c){ return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0; }).map(function(c){ return c.name; }).filter(Boolean);
            var ctx = { kw: meta.kw };

            var isAnim = hasGenre(genres, /animation|мульт|анимац/i);
            var kidsKw = hasKw(ctx, /\b(for kids|children|kids|family-friendly|kids tv)\b/);

            var fDrugs    = inAnyText(ovBoth, /метамфетамин|наркотик|кокаин|героин|марихуан|каннабис|опиум|амфетамин/i) ||
                            inAnyText(ovBoth, /\b(meth|cocaine|coke|heroin|marijuana|cannabis|substance|quaalude|lsd|ecstasy|opium|overdose|dealer|cartel|crack|drug)\b/i) ||
                            hasKw(ctx, /\b(drug|narcotic|addiction|meth|cocaine|coke|heroin|marijuana|substance|quaalude|lsd|ecstasy|opium|overdose|dealer|cartel|crack)\b/);
                            
            var fNudity   = inAnyText(ovBoth, /обнажен|нагот|голы/i) ||
                            inAnyText(ovBoth, /\b(nude|nudity|stripper|topless|bare chest|full frontal)\b/i) ||
                            hasKw(ctx, /\b(nudity|female nudity|male nudity|full frontal|rear nudity|topless|bare chest|breast|stripper)\b/);
                            
            var fSex      = inAnyText(ovBoth, /эротик|откровенн|оргазм|проститут/i) ||
                            inAnyText(ovBoth, /\b(sex|orgy|threesome|hooker|prostitute|seduction|erotic)\b/i) ||
                            hasKw(ctx, /\b(sex scene|sexual content|sexuality|orgy|prostitute|stripper|seduction|erotic|threesome|hooker|explicit)\b/) || !!movie.adult;
                            
            var fViol     = inAnyText(ovBoth, /убийств|кров|жесток|насил|оружи|стрельб|резн|бойн/i) ||
                            inAnyText(ovBoth, /\b(violence|gore|murder|torture|brutal|weapon|gun|massacre|execution|stab|slaughter|bloodshed)\b/i) ||
                            hasKw(ctx, /\b(violence|gore|murder|blood|torture|brutal|weapon|gun|fight|massacre|execution|stab|slaughter)\b/) ||
                            hasGenre(genres, /horror|ужас/i);
                            
            var fSmoke    = inAnyText(ovBoth, /курени|сигарет/i) ||
                            inAnyText(ovBoth, /\b(cigarette|smoking|cigar|vape)\b/i) ||
                            hasKw(ctx, /\b(smoke|smoking|cigarette|cigar)\b/);
                            
            var fAlcohol  = inAnyText(ovBoth, /пьян|выпив|алкогол|водк|виски|пьяниц/i) ||
                            inAnyText(ovBoth, /\b(alcohol|drunkenness|drunk|booze|hangover|alcoholic|vodka|whiskey|binge)\b/i) ||
                            hasKw(ctx, /\b(alcohol|drunkenness|drunk|booze|hangover|alcoholic)\b/);
                            
            var fProfanity= inAnyText(ovBoth, /мат|нецензур|ругательств|брани/i) ||
                            inAnyText(ovBoth, /\b(profanity|f word|vulgarity|cursing|swearing|cuss)\b/i) ||
                            hasKw(ctx, /\b(profanity|f word|vulgarity|cursing|swearing|cuss)\b/);
                            
            var fHate     = inAnyText(ovBoth, /нацист|расизм|ненавист/i) || hasKw(ctx, /\b(racism|nazi|homophob|white supremacist)\b/);
            var fGamb     = inAnyText(ovBoth, /казино|ставк|рулетк|покер/i) || hasKw(ctx, /\b(casino|gamble|gambling|betting|poker)\b/);
            var fAdultAnim= isAnim && hasKw(ctx, /\b(adult animation|dark comedy|black comedy|mature|satire)\b/);
            var anyAdult  = fDrugs || fNudity || fSex || fViol || fSmoke || fAlcohol || fProfanity || fHate || fAdultAnim || !!movie.adult || (age !== null && age >= 16);

            var familyOK = !anyAdult && rating >= 6 && ((age !== null && age <= 12) || kidsKw);

            var mG = genres.filter(function(g){ return blG.some(function(b){ return g.toLowerCase().indexOf(b) >= 0; }); });
            var mA = cast.filter(function(a){ return blA.some(function(b){ return a.toLowerCase().indexOf(b) >= 0; }); });
            var mD = [].concat(dirs, wrts).filter(function(p){ return blD.some(function(b){ return p.toLowerCase().indexOf(b) >= 0; }); });

            var P = [], C = [];
            function addP(t, w) { P.push({ t: t, w: w }); }
            function addC(t, w) { C.push({ t: t, w: w }); }

            if (rating >= 8.0 && votes >= 3000) addP('⭐ Статус: Безоговорочный хит (рейтинг > 8.0)', 30);
            else if (rating >= cfg.min_rating && votes >= 100) addP('⭐ Оперативные данные: Высокие оценки аудитории', 18);
            if (rating > 0 && rating < cfg.min_rating && votes >= 100) addC('📉 Тревожный сигнал: Рейтинг пробил установленное тобой дно (' + rating.toFixed(1) + ')', 22);
            if (rating >= 7.8 && votes >= 100 && votes < 1500) addP('🔎 Профиль: Скрытая жемчужина (высокие оценки, но мало хайпа)', 16);
            if (rating >= 8.0 && votes >= 2000 && yr > 0 && yr <= now - 3) addP('🏛 В архиве: Культовая классика', 18);
            if (yr >= now - 1 && votes >= 200) addP('🔥 Социальный маркер: Активно обсуждается на хайпе', 10);
            
            if (q && !/CAM|TS|HDCAM|SCR|WORKPRINT/i.test(q)) addP('🎥 Тех. параметры: Имеется чистая копия (' + (q || 'HD') + ')', 8);
            if (runtime > 0 && runtime <= 120) addP('🕐 Хронометраж: Идеально под вечер (' + runtime + ' мин.)', 6);
            if (familyOK) addP('🛡 Маркер безопасности: Контент чист, можно с семьей', 14);
            if (hasGenre(genres, /documentary|документ/i)) addP('🧠 Жанр: Расширяет кругозор (документалистика)', 8);
            if (hasGenre(genres, /action|боевик/i)) addP('💥 Динамика: Мощный экшен и высокий темп', 8);

            if (mG.length) addC('⛔ Критическое совпадение: Жанр из твоего черного списка (' + mG.join(', ') + ')', 40);
            if (mA.length) addC('⛔ Критическое совпадение: Актёр из черного списка (' + [...new Set(mA)].slice(0,2).join(', ') + ')', 35);
            if (mD.length) addC('⛔ Критическое совпадение: Режиссер в блэклисте (' + [...new Set(mD)].slice(0,2).join(', ') + ')', 35);

            if (fNudity) addC('🫣 Зафиксирован откровенный контент (нагота)', 14);
            if (fSex) addC('💋 В материале присутствуют постельные сцены', 14);
            if (fViol) addC('🔪 Высокий уровень экранной жестокости', 16);
            if (fDrugs) addC('💉 Фигурируют запрещенные вещества / наркотики', 16);
            if (fProfanity) addC('🤬 Радиоперехват: обилие нецензурной брани', 8);
            if (fHate) addC('🚩 Опасные идеологии (расизм / ненависть)', 16);
            if (runtime > 180) addC('⌛ Затяжной хронометраж: осилишь не за один присест (' + runtime + ' мин.)', 10);
            if (/CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT/i.test(q || '')) addC('⚠️ Тревога: Экранка. Картинка и звук испортят впечатление', 24);
            if (age !== null && age >= 16) addC('🔞 Гриф: ' + age + '+ (Не для детских глаз)', 12);

            var score = 0;
            P.forEach(function(x){ score += x.w; });
            C.forEach(function(x){ score -= x.w; });
            if (score > 100) score = 100; if (score < -100) score = -100;
            var norm = Math.round((score + 100) / 2);
            var vClass = score >= 30 ? 'yes' : (score <= -30 ? 'no' : 'maybe');
            var vWord = score >= 30 ? 'ДОПУСК ОДОБРЕН' : (score <= -30 ? 'ДЕЛО ЗАКРЫТО' : 'НА ТВОЙ СТРАХ');

            function strip(t) { return t ? t.replace(/^[^\s:]+:\s/, '') : ''; }
            var topP = P.slice().sort(function(a,b){ return b.w - a.w; })[0];
            var topC = C.slice().sort(function(a,b){ return b.w - a.w; })[0];
            
            var reason = '';
            if (vClass === 'yes') reason = 'Сводка: Риски минимальны. Ключевой аргумент — ' + (topP ? strip(topP.t) : 'хорошие оценки') + '.';
            else if (vClass === 'no') reason = 'Сводка: Обнаружены критические противопоказания. Главный триггер — ' + (topC ? strip(topC.t) : 'низкий рейтинг') + '.';
            else reason = 'Сводка: Материал нестабильный. С одной стороны (' + (topP ? strip(topP.t) : 'плюсы') + '), с другой (' + (topC ? strip(topC.t) : 'минусы') + '). Решать тебе.';

            var pros = P.map(function(x){ return x.t; });
            var cons = C.map(function(x){ return x.t; });
            if (!pros.length) pros.push('ℹ️ База данных пуста (недостаточно улик для похвалы)');
            if (!cons.length) cons.push('✅ В ходе проверки компромат не обнаружен');

            var audience = buildAudience(pros, cons, genres, rating, familyOK);

            return {
                pros: pros, cons: cons, audience: audience,
                score: score, norm: norm,
                vClass: vClass, vWord: vWord, reason: reason,
                mode: dataRich ? 'TMDB' : 'TAGS'
            };
        });
    }

    /* ===== ОТОБРАЖЕНИЕ ===== */
    function buildModal(movie) {
        var title = esc(movie.title || movie.name || 'Фильм');
        
        Lampa.Modal.open({
            title: 'Досье: ' + title,
            html: $('<div class="sw-modal-content"><div class="sw-loader"><div class="sw-loader-dice">🎲</div><div class="sw-loader-text">Собираем досье на объект...</div><div class="sw-loader-bar"></div></div></div>'),
            size: 'large',
            zIndex: 1000,
            onBack: function() {
                if (window._sw_closingFromController) { window._sw_closingFromController = false; return; }
                restorePrev();
            }
        });
        
        window._sw_prevController = Lampa.Controller.enabled();
        window._sw_focusIdx = 0;
        
        analyze(movie).then(function(data) {
            var html = '<div class="sw-body">';
            
            html += '<div class="sw-dossier sw-focusable" tabindex="0">';
            html += '<div class="sw-mode-badge ' + data.mode.toLowerCase() + '"><span class="sw-mode-dot active"></span>' + (data.mode==='TMDB' ? 'База: TMDB' : 'База: Локальная') + '</div>';
            html += '<div class="sw-verdict-word ' + data.vClass + '">' + esc(data.vWord) + '</div>';
            html += '<div class="sw-verdict-reason">' + esc(data.reason) + '</div>';
            html += '<div class="sw-meter"><div class="sw-meter-fill ' + data.vClass + '" style="width:' + data.norm + '%"></div></div>';
            html += '</div>';

            html += '<div class="sw-columns">';
            html += '<div class="sw-col sw-focusable" tabindex="0"><div class="sw-title pros">🟢 Выявлены преимущества</div><ul class="sw-list">';
            data.pros.forEach(function(p){ html += '<li>' + esc(p) + '</li>'; });
            html += '</ul></div>';

            html += '<div class="sw-col sw-focusable" tabindex="0"><div class="sw-title cons">🔴 Обнаружены риски</div><ul class="sw-list">';
            data.cons.forEach(function(c){ html += '<li>' + esc(c) + '</li>'; });
            html += '</ul></div>';
            html += '</div>';

            html += '<div class="sw-target-audience sw-focusable" tabindex="0"><div class="sw-title target">👤 Психологический профиль зрителя</div><div class="sw-aud-text">' + esc(data.audience) + '</div></div>';

            html += '<div class="sw-btn-close sw-focusable" tabindex="0">ЗАКРЫТЬ ДОСЬЕ</div>';
            html += '</div>';

            var $html = $(html);
            window._sw_currentModalHtml = $('.sw-modal-content').html($html);
            
            $html.find('.sw-btn-close').on('hover:enter click', function() {
                window._sw_closingFromController = true;
                try { Lampa.Modal.close(); } catch(e) {}
                restorePrev();
            });

            Lampa.Controller.toggle(PLUGIN_ID);
        });
    }

    /* ===== ИНТЕГРАЦИЯ В КАРТОЧКУ ===== */
    function addBtn(el, movie) {
        try {
            if (!el || !el.length || el.find('.button--should-watch').length) return;
            var btn = $('<div class="full-start__button selector button--should-watch"><svg viewBox="0 0 100 100" width="22" height="22" style="margin-right:8px" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="8" stroke-linecap="square" fill="none"><path d="M20,55 L40,75 L80,25"/></g></svg><span>Досье</span></div>');
            btn.on('hover:enter click', function () {
                if (movie) buildModal(movie);
            });
            el.find('.full-start__buttons,.full-start-new__buttons,.full-card__buttons').first().append(btn);
        } catch(e) { console.error('[SW] addBtn:', e); }
    }

    Lampa.Listener.follow('full', function (e) {
        if (e.type === 'complite' && e.object) {
            try {
                addBtn(e.object.activity.render(), e.data.movie || e.object.movie);
            } catch(err) { console.error('[SW]', err); }
        }
    });

    // Инициализация
    injectCSS();
    initSettings();

})();
