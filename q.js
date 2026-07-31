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

    /* ===== СТИЛИ (+ янтарный блок сценариев, staggered reveal, hover-lift) ===== */
    function injectCSS() {
        if (document.getElementById('sw-plugin-styles')) return;
        var s = document.createElement('style'); s.id = 'sw-plugin-styles';
        s.innerHTML =
            '.sw-modal-content{padding:20px 22px;color:#fff;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;max-height:88vh;overflow-y:auto;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;scroll-padding:16px}' +
            '.sw-modal-content::-webkit-scrollbar{width:5px}.sw-modal-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,.22);border-radius:3px}' +
            '.sw-body{animation:swFade .35s ease}' +
            '.sw-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:64px 20px;color:#cbd5e1}' +
            '.sw-loader-dice{font-size:3.2em;line-height:1;animation:swBounce 1s ease-in-out infinite;filter:drop-shadow(0 4px 12px rgba(133,194,94,.35))}' +
            '.sw-loader-text{font-size:1.1em;font-weight:600;min-height:1.4em;transition:opacity .25s;color:#94a3b8}' +
            '.sw-loader-bar{width:200px;height:3px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}' +
            '.sw-loader-bar::after{content:"";position:absolute;left:-40%;top:0;height:100%;width:40%;background:linear-gradient(90deg,transparent,#85c25e,transparent);animation:swSlide 1.1s linear infinite}' +
            '.sw-dossier{position:relative;padding:20px 22px;border-radius:16px;margin-bottom:22px;overflow:hidden;background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.015));border:1px solid rgba(255,255,255,.08)}' +
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
            '.sw-col{flex:1;background:rgba(255,255,255,.04);padding:15px 17px;border-radius:12px;border:1px solid rgba(255,255,255,.06)}' +
            '.sw-title{font-family:' + DISPLAY + ';font-size:1.02em;font-weight:800;margin-bottom:13px;text-transform:uppercase;display:flex;align-items:center;gap:8px;letter-spacing:.03em}' +
            '.sw-title.pros{color:#85c25e}.sw-title.cons{color:#d9534f}.sw-title.target{color:#e0e0e0}.sw-title.scen{color:#e0a93b}' +
            '.sw-list{margin:0;padding-left:18px;font-size:.96em;line-height:1.5;color:#cdd3db}.sw-list li{margin-bottom:9px;animation:swFade .4s ease both}' +
            /* янтарный блок сценариев */
            '.sw-scen-wrap{position:relative;margin-bottom:20px;padding:16px 18px;border-radius:14px;background:linear-gradient(160deg,rgba(224,169,59,.10),rgba(224,169,59,.02));border:1px solid rgba(224,169,59,.28);overflow:hidden}' +
            '.sw-scen-wrap::after{content:"";position:absolute;inset:0;background:radial-gradient(90% 70% at 0% 0%,rgba(224,169,59,.12),transparent 55%);pointer-events:none}' +
            '.sw-scen-sub{font-size:.84em;color:#caa45a;margin:-4px 0 13px;line-height:1.4;position:relative}' +
            '.sw-scen-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;position:relative}' +
            '.sw-scen{display:flex;gap:11px;align-items:flex-start;padding:11px 12px;border-radius:11px;background:rgba(0,0,0,.22);border:1px solid rgba(224,169,59,.16);transition:transform .18s ease,border-color .18s ease,background .18s ease;animation:swFade .4s ease both}' +
            '.sw-scen.focus,.sw-scen:hover{transform:translateY(-2px);border-color:rgba(224,169,59,.7);background:rgba(224,169,59,.12);box-shadow:0 6px 18px rgba(0,0,0,.3)}' +
            '.sw-scen-ico{font-size:1.5em;line-height:1;flex:0 0 auto;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))}' +
            '.sw-scen-body{min-width:0}' +
            '.sw-scen-when{font-family:' + DISPLAY + ';font-size:.95em;font-weight:800;color:#f0d9a6;line-height:1.2;letter-spacing:.01em}' +
            '.sw-scen-why{font-size:.8em;color:#a99a78;line-height:1.35;margin-top:3px}' +
            '.sw-quote{position:relative;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:18px 20px 16px 50px;margin-bottom:20px}' +
            '.sw-quote::before{content:"“";position:absolute;left:13px;top:0;font-size:3.3em;line-height:1;color:rgba(255,255,255,.18);font-family:Georgia,serif;font-weight:700}' +
            '.sw-quote-text{font-size:1.03em;line-height:1.55;color:#dfe5ec;font-style:italic}' +
            '.sw-quote-meta{margin-top:9px;font-size:.82em;color:#8b929c}' +
            '.sw-quote-tone{display:inline-block;padding:2px 9px;border-radius:8px;font-style:normal;font-weight:700;margin-left:8px;text-transform:uppercase;font-size:.78em;letter-spacing:.05em}' +
            '.sw-quote-tone.pos{background:rgba(133,194,94,.18);color:#9bd07a}.sw-quote-tone.neg{background:rgba(217,83,79,.18);color:#e88}.sw-quote-tone.mix{background:rgba(224,169,59,.18);color:#e7c06a}' +
            '.sw-target-audience{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);padding:16px 18px;border-radius:12px;line-height:1.6;color:#d6dce4;font-size:1.02em;margin-bottom:20px}' +
            '.sw-aud-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}' +
            '.sw-aud-tag{font-size:.92em;color:#cdd3db;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);padding:5px 12px;border-radius:999px;line-height:1.3}' +
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
            '@keyframes swBounce{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-14px) rotate(6deg)}}' +
            '@keyframes swSlide{0%{left:-40%}100%{left:100%}}' +
            '@keyframes swPulse{0%,100%{box-shadow:0 0 0 0 rgba(133,194,94,.6)}50%{box-shadow:0 0 0 5px rgba(133,194,94,0)}}' +
            '@media(max-width:640px){.sw-columns{flex-direction:column}.sw-verdict-word{font-size:2.2em}.sw-scen-grid{grid-template-columns:1fr 1fr}}';
        document.head.appendChild(s);
    }

    /* ===== УТИЛИТЫ ===== */
    function esc(s) { return typeof s === 'string' ? $('<div>').text(s).html() : ''; }
    function hasGenre(g, re) { return g.some(function(x){ return re.test(x); }); }
    function inText(s, re) { return re.test((s || '').toLowerCase()); }
    function mediaType(m) { return (m && m.name && !m.title) ? 'tv' : 'movie'; }

    /* ===== ДОГРУЗКА ===== */
    function loadCredits(movie) {
        if (movie.credits && ((movie.credits.cast && movie.credits.cast.length) || (movie.credits.crew && movie.credits.crew.length))) return Promise.resolve(movie.credits);
        var id = movie.id || movie.tmdb_id; if (!id) return Promise.resolve(null);
        if (Lampa.TMDB && typeof Lampa.TMDB.credits === 'function') {
            return new Promise(function(res) { Lampa.TMDB.credits(id, function(d){ res(d && !d.status_code ? d : null); }, function(){ res(null); }); });
        }
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
    function mapUSRating(s) { return { 'G':0, 'PG':7, 'PG-13':13, 'R':16, 'NC-17':17 }[(s || '').toUpperCase()] || null; }
    function loadMeta(movie) {
        var id = movie.id || movie.tmdb_id; if (!id) return Promise.resolve({ kw: [], age: null, reviews: [], hasTrailer: false });
        if (_metaCache[id]) return Promise.resolve(_metaCache[id]);
        var type = mediaType(movie);
        return Promise.all([
            tmdbGet('/' + type + '/' + id + '/keywords?'),
            tmdbGet('/' + type + '/' + id + '/content_ratings?'),
            tmdbGet('/' + type + '/' + id + '/reviews?'),
            tmdbGet('/' + type + '/' + id + '/videos?')
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
            var r = { kw: kw, age: age, reviews: reviews, hasTrailer: hasTrailer }; _metaCache[id] = r; return r;
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
    }function analyze(movie) {
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
            var ov = (movie.overview || '').trim();
            var age = meta.age, yr = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : 0;
            var rt = reviewTone(meta.reviews);
            var dataRich = !!(meta.kw.length || age !== null || meta.reviews.length || (credits && credits.crew && credits.crew.length));

            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){ return c.name; }).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){ return c.job === 'Director'; }).map(function(c){ return c.name; }).filter(Boolean);
            var wrts = crew.filter(function(c){ return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0; }).map(function(c){ return c.name; }).filter(Boolean);
            var ctx = { kw: meta.kw };

            var isAnim = hasGenre(genres, /animation|мульт|анимац/i);
            var kidsKw = hasKw(ctx, /for kids|children|\bkids\b|family-friendly|kids tv/);

            // Расширенные флаги контента (словари keywords раздуты; нагота/секс/алкоголь/мат разделены)
            var fDrugs    = inText(ov, /метамфетамин|варк|meth|кокаин|cocaine|героин|heroin|наркот|марихуан|каннабис|опиум|амфетамин/) || hasKw(ctx, /drug|narcotic|addiction|meth|cocaine|coke|heroin|marijuan|substance|quaalude|\blsd\b|ecstasy|opium|overdose|dealer|cartel|crack/);
            var fNudity   = hasKw(ctx, /nudity|female nudity|male nudity|full frontal|rear nudity|topless|bare chest|breast/) || inText(ov, /обнаж|нагот|голы/);
            var fSex      = hasKw(ctx, /sex scene|sexual content|sexuality|orgy|prostitut|stripper|seduction|affair|infidelity|erotic|one-night/) || !!movie.adult || inText(ov, /\bsex\b|эротик|откровен/);
            var fViol     = inText(ov, /violenc|gore|murder|убийств|кров|жесток|насил|оружи|стрельб/) || hasKw(ctx, /violenc|gore|murder|blood|tortur|brutal|weapon|gun|fight|massacre|execution|stab/) || hasGenre(genres, /horror|ужас/i) || (hasGenre(genres, /crime|криминал/i) && hasGenre(genres, /thriller|триллер/i));
            var fSmoke    = inText(ov, /smok|курени/) || hasKw(ctx, /smok|cigarette/);
            var fAlcohol  = inText(ov, /alcohol|пьян|выпив|алкогол/) || hasKw(ctx, /alcohol|drunkenness|drunk|booze|hangover|alcoholic|\bbar\b/);
            var fProfanity= hasKw(ctx, /profanity|f word|strong language|vulgarity|cursing|bad language|swearing/);
            var fHate     = inText(ov, /hate|racis|нацист|расизм|ненавист/) || hasKw(ctx, /racis|nazi|homophob/);
            var fGamb     = inText(ov, /casino|gambl|казино|ставк|\bbet\b|рулетк/) || hasKw(ctx, /casino|gambl|betting/);
            var fAdultAnim= isAnim && hasKw(ctx, /adult animation|dark comed|black comed|dysfunctional|mature|satire/);
            var anyAdult  = fDrugs || fNudity || fSex || fViol || fSmoke || fAlcohol || fProfanity || fHate || fAdultAnim || !!movie.adult || (age !== null && age >= 16);

            var familyOK = !anyAdult && rating >= 6 && ((age !== null && age <= 12) || kidsKw);

            var mG = genres.filter(function(g){ return blG.some(function(b){ return g.toLowerCase().indexOf(b) >= 0; }); });
            var mA = cast.filter(function(a){ return blA.some(function(b){ return a.toLowerCase().indexOf(b) >= 0; }); });
            var mD = [].concat(dirs, wrts).filter(function(p){ return blD.some(function(b){ return p.toLowerCase().indexOf(b) >= 0; }); });

            var P = [], C = [];
            function addP(t, w) { P.push({ t: t, w: w }); }
            function addC(t, w) { C.push({ t: t, w: w }); }

            if (rating >= 8.0 && votes >= 3000) addP('⭐ признание зрителей и критиков', 30);
            else if (rating >= cfg.min_rating && votes >= 100) addP('⭐ оценки стабильно выше среднего', 18);
            if (rating > 0 && rating < cfg.min_rating && votes >= 100) addC('низкие оценки (' + rating.toFixed(1) + ')', 22);
            if (rating >= 7.8 && votes >= 100 && votes < 1500) addP('🔎 скрытая жемчужина', 16);
            if (rating >= 8.0 && votes >= 2000 && yr > 0 && yr <= now - 3) addP('🏛 культовый статус — выдержал проверку временем', 18);
            if (yr >= now - 1 && votes >= 200) addP('🔥 свежий хайп', 10);
            if (votes > 0 && votes < 30) addC('❓ оценок слишком мало, чтобы доверять рейтингу', 8);

            if (rt.tone === 'pos') addP('💬 восторг зрителей', 20);
            else if (rt.tone === 'neg') addC('💬 в отзывах ругают сюжет и темп', 22);
            else if (rt.tone === 'mix') { addP('💬 отзывы полярные — не оставляет равнодушным', 6); addC('💬 часть зрителей разочарована — на любителя', 8); }

            if (q && !/CAM|TS|HDCAM|SCR|WORKPRINT/i.test(q)) addP('🎥 высокое качество видео (' + (q || 'HD') + ')', 8);
            if (runtime > 0 && runtime <= 120) addP('🕐 время просмотра (' + runtime + ' мин.)', 6);
            if (familyOK) addP('🤱 безопасно для семейного просмотра', 14);
            if (hasGenre(genres, /documentary|документ/i)) addP('🦫 познавательно', 8);
            if (inText(ov, /soundtrack|music|composer|score|музык|композитор/) || hasKw(ctx, /music|soundtrack|composer/)) addP('🎵 сильная музыкальная часть', 8);
            if (hasGenre(genres, /action|боевик/i)) addP('💥 драйв и экшен-сцены', 8);
            if (meta.hasTrailer) addP('▶ есть трейлер — глянь 2 минуты, прежде чем решать', 4);

            if (mG.length) addC('⛔ нелюбимый жанр: ' + mG.join(', '), 40);
            if (mA.length) addC('⛔ нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '), 35);
            if (mD.length) addC('⛔ нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '), 35);
            // Минусы-факты: нагота и секс теперь раздельно, алкоголь и мат — отдельные строки
            if (fNudity) addC('🫣 откровенния,нагота', 14);
            if (fSex) addC('💋 сексуальные сцены', 14);
            if (fSmoke) addC('🚬 курение в кадре', 8);
            if (fAlcohol) addC('🍺 алкоголь и пьянство', 10);
            if (fGamb) addC('🎰 тема азартных игр / ставок', 10);
            if (fViol) addC('🔪 жестокие сцены', 16);
            if (fDrugs) addC('💉 тема наркотиков', 16);
            if (fProfanity) addC('🤬 обилие нецензурной лексики', 8);
            if (fHate) addC('🚩 мотивы ненависти / расизма', 16);
            if (runtime > 180) addC('⌛ тяжело высидеть за раз (' + runtime + ' мин.)', 10);
            if (/CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT/i.test(q || '')) addC('📺 экранка — звук и картинка подведут', 24);
            if (age !== null && age >= 16) addC('🔞 ценз ' + age + '+ — не для детей и не для фона', 12);
            if (isAnim && !familyOK) addC('🎭 не детский мультфильм — возможен взрослый юмор и темы', 14);

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
            if (vClass === 'yes') reason = 'Перевесили аргументы «за»' + (topP ? ' — ' + strip(topP.t) : '') + '.';
            else if (vClass === 'no') reason = 'Решающий аргумент «против»' + (topC ? ' — ' + strip(topC.t) : '') + '.';
            else reason = 'Аргументы в балансе — тут решает вкус' + (topP && topC ? ': за «' + strip(topP.t) + '», против «' + strip(topC.t) + '».' : '.');
            if (!dataRich) reason += ' Сигналов маловато — вердикт осторожный.';

            var pros = P.map(function(x){ return x.t; });
            var cons = C.map(function(x){ return x.t; });
            if (!pros.length) pros.push('ℹ️ данных маловато, чтобы советовать');
            if (!cons.length) cons.push((blG.length || blA.length || blD.length) ? '✅ под твои фильтры ничего не попало' : '✅ не нашли минусов');

            var scenarios = buildScenarios({ drugs: fDrugs, nudity: fNudity, sex: fSex, violence: fViol, smoke: fSmoke, alcohol: fAlcohol, profanity: fProfanity, hate: fHate }, runtime);

            var aud = [];
            if (hasGenre(genres, /thriller|horror|триллер|ужас/i)) aud.push('любителям пощекотать нервы');
            if (hasGenre(genres, /comedy|комед/i)) aud.push('ищущим повод посмеяться');
            if (hasGenre(genres, /drama|драма/i) && rating >= 7) aud.push('ценителям сильных характеров');
            if (familyOK) aud.push('семьям для совместного просмотра');
            if (hasGenre(genres, /documentary|документ/i)) aud.push('любознательным');
            if (hasGenre(genres, /sci-fi|fantasy|фантастик/i)) aud.push('мечтающим уйти в другой мир');
            if (rt.tone === 'pos') aud.push('доверяющим восторгу зрителей');
            if (!aud.length) aud.push('зрителям без жёстких предпочтений');

            return {
                pros: pros, cons: cons, audTags: aud, scenarios: scenarios,
                review: rt, score: score, norm: norm,
                vClass: vClass, vWord: vWord, reason: reason,
                mode: dataRich ? 'TMDB' : 'TAGS'
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
        Lampa.Controller.add('should_watch_modal', {
            toggle: function() {
                var h = window._sw_currentModalHtml;
                if (h) { if (h[0]) h[0].scrollTop = 0; Lampa.Controller.collectionSet(h); var b = h.find('#sw-dice-btn'); if (b.length) Lampa.Controller.collectionFocus(b); }
            },
            up: function() { var h = window._sw_currentModalHtml; if (h && h[0] && h[0].scrollTop > 0) h[0].scrollBy({ top: -140, behavior: 'smooth' }); },
            down: function() { var h = window._sw_currentModalHtml; if (h && h[0]) { var max = h[0].scrollHeight - h[0].clientHeight; if (h[0].scrollTop < max) h[0].scrollBy({ top: 140, behavior: 'smooth' }); } },
            left: function() {}, right: function() {},
            back: function() {
                window._sw_rolling = false; window._sw_currentModalHtml = null; clearLoader();
                window._sw_closingFromController = true;
                try { Lampa.Modal.close(); } catch(e) {}
                restorePrev();
            }
        });
    }

    /* ===== РЕНДЕР ===== */
    function buildReadyInner(a) {
        var badge = a.mode === 'TMDB'
            ? '<span class="sw-mode-badge tmdb"><span class="sw-mode-dot active"></span>TMDB</span>'
            : '<span class="sw-mode-badge tags"><span class="sw-mode-dot inactive"></span>TAGS</span>';
        var scen = '';
        if (a.scenarios.length) {
            var cards = a.scenarios.map(function(s, i){
                return '<div class="sw-scen selector" tabindex="0" style="animation-delay:' + (i * 0.06) + 's">' +
                    '<div class="sw-scen-ico">' + s.ico + '</div>' +
                    '<div class="sw-scen-body"><div class="sw-scen-when">' + esc(s.when) + '</div><div class="sw-scen-why">' + esc(s.why) + '</div></div>' +
                '</div>';
            }).join('');
            scen = '<div class="sw-scen-wrap"><div class="sw-title scen">⚠ Когда лучше не включать</div>' +
                '<div class="sw-scen-sub"></div>' +
                '<div class="sw-scen-grid">' + cards + '</div></div>';
        }
        var quote = '';
        if (a.review.sample) {
            var toneLabel = a.review.tone === 'pos' ? 'хвалебный' : (a.review.tone === 'neg' ? 'критический' : 'спорный');
            var toneCls = a.review.tone === 'pos' ? 'pos' : (a.review.tone === 'neg' ? 'neg' : 'mix');
            var txt = a.review.sample.text.length > 240 ? a.review.sample.text.substring(0, 240).trim() + '…' : a.review.sample.text;
            quote = '<div class="sw-quote"><div class="sw-quote-text">' + esc(txt) + '</div><div class="sw-quote-meta">— ' + esc(a.review.sample.author) + ', отзыв зрителя<span class="sw-quote-tone ' + toneCls + '">' + toneLabel + '</span></div></div>';
        }
        var tags = a.audTags.map(function(t){ return '<span class="sw-aud-tag">' + esc(t) + '</span>'; }).join('');
        return '' +
            '<div class="sw-dossier">' + badge +
                '<div class="sw-verdict-word ' + a.vClass + '">' + a.vWord + '</div>' +
                '<div class="sw-verdict-reason">' + esc(a.reason) + '</div>' +
                '<div class="sw-meter"><div class="sw-meter-fill ' + a.vClass + '" data-w="' + a.norm + '"></div></div>' +
            '</div>' +
            '<div class="sw-columns">' +
                '<div class="sw-col"><div class="sw-title pros">✓ Аргументы за</div><ul class="sw-list">' + a.pros.map(function(p, i){ return '<li style="animation-delay:' + (i * 0.05) + 's">' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
                '<div class="sw-col"><div class="sw-title cons">✗ Аргументы против</div><ul class="sw-list">' + a.cons.map(function(c, i){ return '<li style="animation-delay:' + (i * 0.05) + 's">' + esc(c) + '</li>'; }).join('') + '</ul></div>' +
            '</div>' +
            scen +
            quote +
            '<div class="sw-target-audience"><div class="sw-title target">🎯 Кому зайдёт</div><div class="sw-aud-tags">' + tags + '</div></div>' +
            '<div class="sw-decision">' +
                '<div class="sw-decision-hint">послушай сердце,или доверься случаю</div>' +
                '<div class="sw-dice-btn selector" id="sw-dice-btn"><span style="font-size:1.4em">🎲</span> Бросить кости</div>' +
                '<div class="sw-verdict-roll" id="sw-verdict"></div>' +
            '</div>';
    }
    function bindDice(html) {
        html.find('#sw-dice-btn').on('hover:enter click keydown', function(e) {
            try {
                if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                if (window._sw_rolling) return; window._sw_rolling = true;
                var btn = $(this), v = html.find('#sw-verdict');
                v.attr('style', '').attr('class', 'sw-verdict-roll').text(''); btn.addClass('shake');
                setTimeout(function() {
                    try {
                        btn.removeClass('shake');
                        if (Math.random() > 0.5) v.text('Смотреть!').addClass('verdict-yes').css({color:'#85c25e',textShadow:'0 0 12px rgba(133,194,94,.35)'});
                        else v.text('Не смотреть').addClass('verdict-no').css({color:'#d9534f',textShadow:'0 0 12px rgba(217,83,79,.35)'});
                        Lampa.Controller.collectionFocus(btn);
                        try { btn[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(_) {}
                    } catch(err) { console.error('[SW] dice render:', err); }
                    window._sw_rolling = false;
                }, 500);
            } catch(err) { console.error('[SW] dice handler:', err); window._sw_rolling = false; }
        });
    }

    function showModal(movie) {
        var title = esc(movie.title || movie.name || 'Фильм');
        try { window._sw_prevController = Lampa.Controller.enabled ? Lampa.Controller.enabled() : null; } catch(e) { window._sw_prevController = null; }
        var phrases = ['Подгружаю съёмочную группу…', 'Читаю отзывы зрителей…', 'Проверяю ценз и теги…', 'Собираю сценарии просмотра…'];
        var html = $('<div class="sw-modal-content"><div id="sw-body"><div class="sw-loader"><div class="sw-loader-dice">🎲</div><div class="sw-loader-text" id="sw-loader-text">' + phrases[0] + '</div><div class="sw-loader-bar"></div></div></div></div>');
        window._sw_currentModalHtml = html;
        var pi = 0;
        window._sw_loaderTimer = setInterval(function() {
            pi = (pi + 1) % phrases.length; var t = html.find('#sw-loader-text');
            if (t.length) { t.css('opacity', 0); setTimeout(function(){ t.text(phrases[pi]).css('opacity', 1); }, 200); }
        }, 750);

        Lampa.Modal.open({
            title: 'Стоит ли смотреть: ' + title, html: html, size: 'large', zIndex: 1000,
            onBack: function() {
                window._sw_rolling = false; window._sw_currentModalHtml = null; clearLoader();
                if (window._sw_closingFromController) { window._sw_closingFromController = false; return; }
                restorePrev();
            }
        });

        analyze(movie).then(function(a) {
            clearLoader();
            html.find('#sw-body').html('<div class="sw-body">' + buildReadyInner(a) + '</div>');
            bindDice(html);
            setTimeout(function() { html.find('.sw-meter-fill').each(function(){ this.style.width = (this.getAttribute('data-w') || 50) + '%'; }); }, 120);
            Lampa.Controller.toggle('should_watch_modal');
        }).catch(function(err) {
            clearLoader();
            console.error('[SW] analyze:', err);
            html.find('#sw-body').html('<div class="sw-body" style="text-align:center;padding:40px;color:#d9534f">Ошибка анализа</div>');
        });
    }

    /* ===== ИНЪЕКЦИЯ ===== */
    function addBtn(el, movie) {
        if (!el || !el.length || el.find('.sw-custom-button').length) return;
        var btn = $('<div class="full-start__button selector sw-custom-button" data-type="should_watch"><div class="full-start__icon">' + ICON + '</div><span>Стоит ли?</span></div>');
        btn.on('hover:enter', function() { if (movie) showModal(movie); });
        var anchor = el.find('.view--torrent,.view--online,.view--trailer').last();
        if (anchor.length) anchor.after(btn);
        else { var fb = el.find('.full-start__buttons,.full-start-new__buttons,.full-card__buttons'); if (fb.length) fb.append(btn); }
    }

    function startPlugin() {
        try { registerController(); } catch(e) {}
        try { Lampa.Listener.follow('full', function(e) { if (e.type !== 'complite') return; try { addBtn(e.object.activity.render(), e.data.movie); } catch(err) { console.error('[SW]', err); } }); } catch(e) {}
        try { initSettings(); } catch(e) {}
        try { injectCSS(); } catch(e) {}
        console.log('[ShouldWatch] v22.0 (split nudity/sex/alcohol/profanity + viewing scenarios).');
    }
    try { if (window.appready) startPlugin(); else Lampa.Listener.follow('app', function(e){ if (e.type === 'ready') startPlugin(); }); } catch(e) {}
})();
