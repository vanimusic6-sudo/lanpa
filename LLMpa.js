(function () {
    'use strict';
    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;

    var PLUGIN_ID = 'should_watch_plugin';
    var ICON = '<svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="8" stroke-linecap="square" fill="none"><path d="M20,55 L40,75 L80,25"/><path d="M25,25 L75,75" stroke-dasharray="4,4"/></g></svg>';

    window._sw_rolling = false;
    window._sw_currentModalHtml = null;
    window._sw_prevController = null;
    window._sw_loaderTimer = null;
    window._sw_lastError = '';
    var _extraCache = {}, _aiCache = {};

    function getSetting(k, d) { try { var v = Lampa.Storage.get(PLUGIN_ID + '_' + k); if (v !== undefined && v !== null && v !== '') return v; } catch(e) {} return d; }
    function saveSetting(k, v) { try { Lampa.Storage.set(PLUGIN_ID + '_' + k, v); } catch(e) {} }
    function getSettings() {
        return {
            bad_genres: String(getSetting('bad_genres', '') || ''),
            bad_actors: String(getSetting('bad_actors', '') || ''),
            bad_directors: String(getSetting('bad_directors', '') || ''),
            min_rating: parseFloat(getSetting('min_rating', '6')) || 6,
            api_key: String(getSetting('api_key', '') || '').trim(),
            proxy_url: String(getSetting('proxy_url', '') || '').trim(),
            model: String(getSetting('model', 'llama-3.3-70b-versatile') || 'llama-3.3-70b-versatile').trim(),
            ai_mode: String(getSetting('ai_mode', 'hybrid') || 'hybrid')
        };
    }
    function parseBL(s) { return s ? s.split(',').map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean) : []; }
    function ensureDefaults() {
        ['bad_genres','bad_actors','bad_directors','api_key','proxy_url','model'].forEach(function(k){
            try { if (Lampa.Storage.get(PLUGIN_ID + '_' + k) === undefined) Lampa.Storage.set(PLUGIN_ID + '_' + k, ''); } catch(e) {}
        });
    }
    function initSettings() {
        if (!window.Lampa || !Lampa.SettingsApi || window.sw_settings_ready) return;
        window.sw_settings_ready = true;
        Lampa.SettingsApi.addComponent({ component: PLUGIN_ID, name: 'Стоит ли смотреть?', icon: ICON });
        [
            { name: 'api_key', type: 'input', title: 'Groq API-ключ (ТОЛЬКО gsk_…)', description: 'СЮДА НЕ адрес воркера! Ключ брать на console.groq.com/keys', default: '' },
            { name: 'proxy_url', type: 'input', title: 'Прокси-URL воркера (Android/смартфон)', description: 'https://lampall.vanisesternin.workers.dev — БЕЗ слэша в конце. На ПК можно пусто.', default: '' },
            { name: 'model', type: 'input', title: 'Модель ИИ', description: 'llama-3.3-70b-versatile. Меняй только при ошибке про модель.', default: 'llama-3.3-70b-versatile' },
            { name: 'ai_mode', type: 'select', title: 'Режим анализа', values: {'hybrid':'ИИ + теги','ai_only':'Только ИИ','tags_only':'Только теги TMDB'}, default: 'hybrid' },
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

    function injectCSS() {
        if (document.getElementById('sw-plugin-styles')) return;
        var s = document.createElement('style'); s.id = 'sw-plugin-styles';
        s.innerHTML =
            '.sw-modal-content{padding:20px;color:#fff;font-family:sans-serif;max-height:72vh;overflow-y:auto;scroll-behavior:smooth}' +
            '.sw-modal-content::-webkit-scrollbar{width:5px}.sw-modal-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:3px}' +
            '.sw-body{animation:swFade .35s ease}' +
            '.sw-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:60px 20px;color:#cbd5e1}' +
            '.sw-loader-dice{font-size:3.2em;line-height:1;animation:swBounce 1s ease-in-out infinite;filter:drop-shadow(0 4px 12px rgba(245,80,54,.35))}' +
            '.sw-loader-text{font-size:1.15em;font-weight:600;min-height:1.4em;transition:opacity .25s;color:#94a3b8}' +
            '.sw-loader-bar{width:180px;height:3px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}' +
            '.sw-loader-bar::after{content:"";position:absolute;left:-40%;top:0;height:100%;width:40%;background:linear-gradient(90deg,transparent,#f55036,transparent);animation:swSlide 1.1s linear infinite}' +
            '.sw-err{margin-top:14px;font-size:.82em;color:#ffd2d2;background:rgba(217,83,79,.14);border:1px solid rgba(217,83,79,.35);border-radius:8px;padding:9px 12px;line-height:1.45;word-break:break-word;text-align:left}' +
            '.sw-mode-badge{display:inline-flex;align-items:center;gap:6px;font-size:.75em;padding:4px 12px;border-radius:10px;margin-left:10px;vertical-align:middle;font-weight:700;letter-spacing:.06em;text-transform:uppercase}' +
            '.sw-mode-badge.ai{background:#f55036;color:#fff}.sw-mode-badge.tags{background:rgba(255,255,255,.15);color:#ccc}.sw-mode-badge.error{background:#7a2020;color:#ffd2d2}' +
            '.sw-mode-dot{width:8px;height:8px;border-radius:50%;display:inline-block}' +
            '.sw-mode-dot.active{background:#85c25e;animation:swPulse 1.4s ease-in-out infinite}.sw-mode-dot.inactive{background:#d9534f}' +
            '.sw-dice-section{text-align:center;margin-bottom:30px;padding:20px;background:rgba(255,255,255,.03);border-radius:12px}' +
            '.sw-dice-btn{background:#eadecd;color:#1a1a1a;font-size:1.4em;font-weight:bold;padding:15px 40px;border-radius:30px;display:inline-flex;align-items:center;gap:15px;transition:transform .2s,background .2s,box-shadow .2s;cursor:pointer;outline:none;border:3px solid transparent}' +
            '.sw-dice-btn.focus{background:#fff;transform:scale(1.05);box-shadow:0 0 0 3px #fff,0 0 20px rgba(255,255,255,.4);border-color:#fff}' +
            '.sw-dice-btn.shake{animation:swShake .5s}' +
            '.sw-verdict{margin-top:15px;font-size:1.6em;font-weight:bold;min-height:40px;text-transform:uppercase;transition:color .2s}' +
            '.sw-verdict.verdict-yes{color:#85c25e!important;text-shadow:0 0 10px rgba(133,194,94,.3)}' +
            '.sw-verdict.verdict-no{color:#d9534f!important;text-shadow:0 0 10px rgba(217,83,79,.3)}' +
            '.sw-columns{display:flex;justify-content:space-between;gap:20px;margin-bottom:25px}' +
            '.sw-col{flex:1;background:rgba(255,255,255,.05);padding:15px;border-radius:10px}' +
            '.sw-title{font-size:1.1em;font-weight:bold;margin-bottom:15px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:10px}' +
            '.sw-title.pros{color:#85c25e}.sw-title.cons{color:#d9534f}.sw-title.target{color:#e0e0e0}' +
            '.sw-list{margin:0;padding-left:20px;font-size:.95em;line-height:1.5;color:#ccc}.sw-list li{margin-bottom:10px;animation:swFade .4s ease both}' +
            '.sw-target-audience{background:rgba(255,255,255,.05);padding:20px;border-radius:10px;line-height:1.6;color:#ddd;font-size:1.05em}' +
            '@keyframes swShake{0%,100%{transform:translate(1px,-2px) rotate(-1deg)}10%,30%,50%,70%,90%{transform:translate(-1px,2px) rotate(1deg)}20%,40%,60%,80%{transform:translate(-3px,0) rotate(0deg)}}' +
            '@keyframes swFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}' +
            '@keyframes swBounce{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-14px) rotate(6deg)}}' +
            '@keyframes swSlide{0%{left:-40%}100%{left:100%}}' +
            '@keyframes swPulse{0%,100%{box-shadow:0 0 0 0 rgba(133,194,94,.6)}50%{box-shadow:0 0 0 5px rgba(133,194,94,0)}}';
        document.head.appendChild(s);
    }

    function esc(s) { return typeof s === 'string' ? $('<div>').text(s).html() : ''; }
    function hasGenre(g, re) { return g.some(function(x){ return re.test(x); }); }
    function inText(s, re) { return re.test((s || '').toLowerCase()); }
    function mediaType(m) { return (m && m.name && !m.title) ? 'tv' : 'movie'; }
    function cleanNum(s) { return typeof s === 'string' ? s.replace(/\d+\.\d{2,}/g, function(m){ return parseFloat(m).toFixed(1); }) : s; }
    function isGarbage(s) { return /не указан|нет данных|неизвестн|потенциально|возможно,|заставляет задуматься/i.test(s || ''); }

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
                fetch('https://api.themoviedb.org/3' + path + '&api_key=' + tmdbKey()).then(function(r){ return r.json(); }).then(function(d){ res(d && d.status_code ? null : d); }).catch(function(){ res(null); });
            } catch(e) { res(null); }
        });
    }
    function mapUSRating(s) { return { 'G':0, 'PG':7, 'PG-13':13, 'R':16, 'NC-17':17 }[(s || '').toUpperCase()] || null; }
    function loadExtra(movie) {
        var id = movie.id || movie.tmdb_id; if (!id) return Promise.resolve({ kw: [], age: null });
        if (_extraCache[id]) return Promise.resolve(_extraCache[id]);
        var type = mediaType(movie);
        return Promise.all([ tmdbGet('/' + type + '/' + id + '/keywords?'), tmdbGet('/' + type + '/' + id + '/content_ratings?') ]).then(function(arr) {
            var kw = [];
            if (arr[0]) (arr[0].keywords || arr[0].results || []).forEach(function(k){ if (k && k.name) kw.push(k.name.toLowerCase()); });
            var age = null;
            if (arr[1] && arr[1].results) {
                var ru = arr[1].results.find(function(x){ return x.iso_3166_1 === 'RU'; });
                var us = arr[1].results.find(function(x){ return x.iso_3166_1 === 'US'; });
                if (ru && ru.rating) { var n = parseInt(ru.rating); if (!isNaN(n)) age = n; }
                if (age === null && us && us.rating) age = mapUSRating(us.rating);
            }
            var r = { kw: kw, age: age }; _extraCache[id] = r; return r;
        });
    }
    function hasKw(ctx, re) { return ctx.kw.some(function(k){ return re.test(k); }); }

    function analyzeWithGroq(movie, facts, key, proxy, model) {
        var id = movie.id || movie.tmdb_id;
        if (id && _aiCache[id]) return Promise.resolve(_aiCache[id]);
        var title = movie.title || movie.name || '';
        var year = (movie.release_date || movie.first_air_date || '').substring(0, 4);
        var genres = (movie.genres || []).map(function(g){ return g.name; }).join(', ');
        var overview = (movie.overview || '').substring(0, 1500);
        var rating = (parseFloat(movie.vote_average) || 0).toFixed(1);
        var votes = parseInt(movie.vote_count) || 0;
        var factsBlock = facts.length ? facts.join('\n') : '(доп. факты отсутствуют)';
        var systemPrompt = 'Ты — язвительный, но точный кинокритик. Пишешь коротко и по делу, без воды. Отвечай СТРОГО одним JSON-объектом, без markdown, без ``` и без пояснений вне JSON.';
        var userPrompt =
            'Фильм/сериал: "' + title + '" (' + year + ')\nЖанры: ' + genres + '\nРейтинг: ' + rating + ' из 10 (' + votes + ' голосов)\nСинопсис: ' + overview + '\n\n' +
            'ИЗВЕСТНЫЕ ФАКТЫ (бери только отсюда, не выдумывай):\n' + factsBlock + '\n\n' +
            'Верни JSON вида:\n{"pros":[...],"cons":[...],"audience":"..."}\n\n' +
            'pros: 3-6 пунктов, каждый = один факт, 4-9 слов, эмодзи в начале. Рейтинг пиши ТОЛЬКО как ' + rating + '.\n' +
            'cons: 0-6 пунктов. Проверяй: насилие, наркотики, курение/алкоголь, нагота, жестокость, азартные игры, ненависть, плохое качество (CAM/TS), хронометраж >180 мин, ценз 16+/18+. Для криминала/триллера/ужасов и тем про наркотики cons НЕ пустой. Анимация НЕ делает фильм семейным при взрослом цензе/насилии/наркотиках.\n' +
            'audience: одно предложение, начинается с "Любителям".\n' +
            'Эмодзи подбери САМ по смыслу: ⭐ рейтинг |  режиссёр | ✍️ сценарист | 🎭 актёры | 🎵 музыка | 💥 экшен | 🎥 качество | 🕐 хронометраж | 🆕 новинка | 🔎 признание | 🤱 семейный | 🦫 познавательный | 🌍 страны | 🔗 франшиза | 💋 откровенность | 🚬 курение/алкоголь | 🎰 азарт | 🔪 насилие | 💉 наркотики | 📺 плохое качество | 🚩 ненависть | 🔞 ценз | ⌛ слишком длинный.\n' +
            'ЗАПРЕТЫ: эмодзи ⛔ не используй. Не повторяй эмодзи в одном списке. Если факта нет в ИЗВЕСТНЫЕ ФАКТЫ — НЕ создавай пункт и НИКОГДА не пиши "не указан/нет данных/неизвестно/потенциально/возможно".\n' +
            'АНТИ-ПРИМЕРЫ: ❌ "🎬 режиссёр: не указан" ❌ " потенциально высокий хронометраж" ❌ "заставляет задуматься о мире" ❌ "высокий рейтинг (7.591/10)".\n' +
            'ЭТАЛОН ("Джокер", 8.4, реж. Тодд Филлипс, Хоакин Феникс, 122 мин, 18+):\n{"pros":["⭐ высокий рейтинг (8.4)","🎬 режиссёр: Тодд Филлипс","🎭 Хоакин Феникс в главной роли","🕐 комфортный хронометраж (122 мин)"],"cons":["🔪 сцены насилия","💉 тема психического расстройства","🔞 ценз 18+ — не для детей"],"audience":"Любителям мрачных драм и бенефисов одного актёра."}';

        var endpoint = proxy || 'https://api.groq.com/openai/v1/chat/completions';
        return new Promise(function(res) {
            try {
                if (typeof fetch === 'undefined') { window._sw_lastError = 'fetch недоступен в этой сборке'; return res(null); }
                fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                    body: JSON.stringify({ model: model, messages: [ { role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt } ], temperature: 0.35, max_tokens: 1500, response_format: { type: 'json_object' } })
                })
                .then(function(r) {
                    return r.text().then(function(txt) {
                        if (!r.ok) {
                            var msg = txt; try { var ej = JSON.parse(txt); msg = (ej.error && ej.error.message) || txt; } catch(_) {}
                            window._sw_lastError = 'HTTP ' + r.status + ': ' + (msg || '').substring(0, 220);
                            console.error('[SW] Groq HTTP', r.status, txt); return null;
                        }
                        try {
                            var data = JSON.parse(txt);
                            if (data && data.choices && data.choices[0] && data.choices[0].message) {
                                var t = (data.choices[0].message.content || '').replace(/```json/g, '').replace(/```/g, '').trim();
                                var json = JSON.parse(t); if (id) _aiCache[id] = json; window._sw_lastError = ''; return json;
                            }
                            window._sw_lastError = (data && data.error && data.error.message) || 'пустой ответ Groq'; return null;
                        } catch(e) { window._sw_lastError = 'парсинг: ' + e.message; return null; }
                    });
                })
                .then(function(json){ res(json); })
                .catch(function(err) { window._sw_lastError = 'сеть: ' + (err && err.message ? err.message : err); res(null); });
            } catch(e) { window._sw_lastError = 'исключение: ' + e.message; res(null); }
        });
    }

    function analyze(movie) {
        var cfg = getSettings();
        // --- защита от путаницы полей + нормализация ---
        var confused = false;
        var key = cfg.api_key;
        var proxy = cfg.proxy_url;
        if (/^https?:\/\//i.test(key)) {
            confused = true;
            if (!proxy) proxy = key;   // спасаем адрес в прокси
            key = '';                  // ключа реально нет
            window._sw_lastError = 'Адрес воркера попал в поле «Groq API-ключ». Перенеси его в поле «Прокси-URL воркера», а в «Groq API-ключ» вставь ключ gsk_… (console.groq.com/keys).';
        }
        proxy = (proxy || '').replace(/\/+$/, '').trim();

        var useAI = !!key && (cfg.ai_mode === 'hybrid' || cfg.ai_mode === 'ai_only');

        return Promise.all([ loadCredits(movie), loadExtra(movie) ]).then(function(arr) {
            var credits = arr[0], extra = arr[1];
            var q = (movie.quality || movie.source_quality || '').toString().toUpperCase();
            var rating = parseFloat(movie.vote_average) || 0, votes = parseInt(movie.vote_count) || 0;
            var runtime = parseInt(movie.runtime) || 0;
            var genres = (movie.genres || []).map(function(g){ return g.name; }).filter(Boolean);
            var ov = (movie.overview || '').trim(), age = extra.age;
            var yr = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : 0;
            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){ return c.name; }).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){ return c.job === 'Director'; }).map(function(c){ return c.name; }).filter(Boolean);
            var wrts = crew.filter(function(c){ return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0; }).map(function(c){ return c.name; }).filter(Boolean);
            var ctx = { kw: extra.kw };

            var facts = [];
            if (dirs.length) facts.push('РЕЖИССЁР: ' + dirs.join(', '));
            if (wrts.length) facts.push('СЦЕНАРИСТ: ' + wrts.join(', '));
            if (cast.length) facts.push('В РОЛЯХ: ' + cast.slice(0, 6).join(', '));
            if (runtime > 0) facts.push('ХРОНОМЕТРАЖ: ' + runtime + ' мин');
            if (q) facts.push('КАЧЕСТВО ВИДЕО: ' + q);
            if (age !== null) facts.push('ВОЗРАСТНОЙ ЦЕНЗ: ' + age + '+');
            if (movie.origin_country && movie.origin_country.length) facts.push('СТРАНЫ: ' + movie.origin_country.join(', '));
            if (yr) facts.push('ГОД ВЫХОДА: ' + yr);

            var aiPromise = useAI ? analyzeWithGroq(movie, facts, key, proxy, cfg.model) : Promise.resolve(null);

            return aiPromise.then(function(aiResult) {
                var blG = parseBL(cfg.bad_genres), blA = parseBL(cfg.bad_actors), blD = parseBL(cfg.bad_directors);
                if (aiResult && Array.isArray(aiResult.pros) && Array.isArray(aiResult.cons)) {
                    var P = aiResult.pros.map(cleanNum).filter(function(s){ return s && !isGarbage(s); });
                    var C = aiResult.cons.map(cleanNum).filter(function(s){ return s && !isGarbage(s); });
                    var mG = genres.filter(function(g){ return blG.some(function(b){ return g.toLowerCase().indexOf(b) >= 0; }); });
                    var mA = cast.filter(function(a){ return blA.some(function(b){ return a.toLowerCase().indexOf(b) >= 0; }); });
                    var mD = [].concat(dirs, wrts).filter(function(p){ return blD.some(function(b){ return p.toLowerCase().indexOf(b) >= 0; }); });
                    if (mG.length) C.push('⛔ Нелюбимый жанр: ' + mG.join(', '));
                    if (mA.length) C.push('⛔ Нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '));
                    if (mD.length) C.push('⛔ Нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '));
                    return { pros: P, cons: C, audience: cleanNum(aiResult.audience) || 'Любителям кино.', mode: 'AI' };
                }

                var mode = (useAI || confused) ? 'AI_ERROR' : 'TAGS';
                var fDrugs = inText(ov, /метамфетамин|варк|meth|кокаин|cocaine|героин|heroin|наркот|марихуан|каннабис|опиум|амфетамин/) || hasKw(ctx, /drug|narcotic|addiction|meth|cocaine|heroin|marijuan|substance/);
                var fViol = inText(ov, /violenc|gore|murder|убийств|кров|жесток|насил|оружи|стрельб/) || hasKw(ctx, /violenc|gore|murder|blood|tortur|brutal|weapon|gun|fight/) || hasGenre(genres, /horror|ужас/i) || (hasGenre(genres, /crime|криминал/i) && hasGenre(genres, /thriller|триллер/i));
                var fSmoke = inText(ov, /smok|alcohol|\bdrink\b|пьян|курени|выпив/) || hasKw(ctx, /smok|cigarette|alcohol|drink|drunk|bar/);
                var fSex = !!movie.adult || inText(ov, /\bsex\b|nudity|обнаж|эротик|откровен/) || hasKw(ctx, /nudity|sex|sexual|erotic|stripper|prostitut/);
                var fHate = inText(ov, /hate|racis|нацист|расизм|ненавист/) || hasKw(ctx, /racis|nazi|homophob/);
                var anyAdult = fDrugs || fViol || fSmoke || fSex || fHate || !!movie.adult || (age !== null && age >= 16);
                var familyOK = (hasGenre(genres, /family|animation|семейн|мульт|детск/i) || hasKw(ctx, /for kids|children|\bkids\b|family/)) && !anyAdult && (age === null || age <= 12) && rating >= 6;
                var P = [], C = [];
                if (rating >= cfg.min_rating && votes >= 100) P.push('⭐ высокий рейтинг (' + rating.toFixed(1) + ')');
                if (dirs.length) P.push('🎬 режиссёр: ' + dirs[0]);
                if (inText(ov, /soundtrack|music|composer|score|музык/) || hasKw(ctx, /music|soundtrack|composer/)) P.push('🎵 хорошая музыкальная составляющая');
                if (hasGenre(genres, /action|боевик/i)) P.push('💥 впечатляющие экшен-сцены');
                if (familyOK) P.push('🤱 подойдет для семейного просмотра');
                if (hasGenre(genres, /documentary|документ/i)) P.push('🦫 полезная информация');
                if (q && !/CAM|TS|HDCAM|SCR|WORKPRINT/i.test(q)) P.push('🎥 отличное качество видео (' + (q || 'HD') + ')');
                if (runtime > 0 && runtime <= 130) P.push('🕐 комфортный хронометраж (' + runtime + ' мин.)');
                if ((movie.origin_country || []).length > 2) P.push('🌍 дружба народов');
                if (rating >= 8.0 && votes >= 3000) P.push('🔎 находка — в числе лучших по оценкам');
                if (yr >= new Date().getFullYear() - 1) P.push('🔥 горячие новинки');
                var mG2 = genres.filter(function(g){ return blG.some(function(b){ return g.toLowerCase().indexOf(b) >= 0; }); });
                var mA2 = cast.filter(function(a){ return blA.some(function(b){ return a.toLowerCase().indexOf(b) >= 0; }); });
                var mD2 = [].concat(dirs, wrts).filter(function(p){ return blD.some(function(b){ return p.toLowerCase().indexOf(b) >= 0; }); });
                if (mG2.length) C.push('⛔ Нелюбимый жанр: ' + mG2.join(', '));
                if (mA2.length) C.push('⛔ Нелюбимый актёр: ' + [...new Set(mA2)].slice(0,2).join(', '));
                if (mD2.length) C.push('⛔ Нелюбимый автор: ' + [...new Set(mD2)].slice(0,2).join(', '));
                if (fSex) C.push('💋 откровенные сцены');
                if (fSmoke) C.push('🚬 курение или употребление алкоголя');
                if (inText(ov, /casino|gambl|казино|ставк|\bbet\b|рулетк/) || hasKw(ctx, /casino|gambl|betting/)) C.push('🎰 игромания');
                if (fViol) C.push('🔪 жестокие сцены');
                if (runtime > 180) C.push('⌛ высокий хронометраж (' + runtime + ' мин.)');
                if (fDrugs) C.push('💉 употребление наркотиков');
                if (/CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT/i.test(q || '')) C.push('📺 низкое качество видео (' + q + ')');
                if (fHate) C.push('🚩 разжигание ненависти');
                if (age !== null && age >= 16) C.push('🔞 возрастной ценз ' + age + '+ — не для детей');
                var AW = [
                    { w: 'экшена', t: hasGenre(genres, /action|боевик/i) }, { w: 'качества картинки', t: q && !/CAM|TS|HDCAM|SCR/i.test(q) },
                    { w: 'хорошей музыки', t: inText(ov, /soundtrack|music|composer|score|музык/) }, { w: 'полезного времени', t: hasGenre(genres, /documentary|документ/i) },
                    { w: 'испытать нервы', t: hasGenre(genres, /thriller|horror|триллер|ужас/i) }, { w: 'семейного вечера', t: familyOK },
                    { w: 'новинки', t: yr >= new Date().getFullYear() - 1 }, { w: 'драмы', t: hasGenre(genres, /drama|драма/i) },
                    { w: 'комедии', t: hasGenre(genres, /comedy|комед/i) }, { w: 'фантастики', t: hasGenre(genres, /sci-fi|fantasy|фантастик/i) }
                ];
                var matched = AW.filter(function(x){ return x.t; }).map(function(x){ return x.w; });
                var audience = matched.length ? 'Любителям ' + matched.slice().sort(function(){ return Math.random() - 0.5; }).join(', ') + '.' : 'Любителям кино.';
                return { pros: P, cons: C, audience: audience, mode: mode };
            });
        });
    }

    function registerController() {
        Lampa.Controller.add('should_watch_modal', {
            toggle: function() { var h = window._sw_currentModalHtml; if (h) { Lampa.Controller.collectionSet(h); var b = h.find('#sw-dice-btn'); if (b.length) Lampa.Controller.collectionFocus(b); } },
            up: function() { var h = window._sw_currentModalHtml; if (h && h[0] && h[0].scrollTop > 0) h[0].scrollBy({ top: -120, behavior: 'smooth' }); },
            down: function() { var h = window._sw_currentModalHtml; if (h && h[0]) h[0].scrollBy({ top: 120, behavior: 'smooth' }); },
            left: function() {}, right: function() {},
            back: function() {
                window._sw_rolling = false; window._sw_currentModalHtml = null;
                if (window._sw_loaderTimer) { clearInterval(window._sw_loaderTimer); window._sw_loaderTimer = null; }
                var prev = window._sw_prevController; window._sw_prevController = null;
                try { Lampa.Modal.close(); } catch(e) {}
                try { if (prev && prev.name) Lampa.Controller.toggle(prev.name); else Lampa.Controller.toggle('full_start'); } catch(e) { try { Lampa.Controller.toggle('full'); } catch(_) {} }
            }
        });
    }

    function buildReadyInner(a) {
        var badge = a.mode === 'AI' ? '<span class="sw-mode-badge ai"><span class="sw-mode-dot active"></span>GROQ</span>'
            : a.mode === 'AI_ERROR' ? '<span class="sw-mode-badge error"><span class="sw-mode-dot inactive"></span>AI (ошибка)</span>'
            : '<span class="sw-mode-badge tags"><span class="sw-mode-dot inactive"></span>TAGS</span>';
        var errBox = (a.mode === 'AI_ERROR' && window._sw_lastError) ? '<div class="sw-err">⚠ ' + esc(window._sw_lastError) + '</div>' : '';
        return '<div class="sw-dice-section"><div class="sw-dice-btn selector" id="sw-dice-btn"><span style="font-size:1.5em">🎲</span> Бросить кости' + badge + '</div><div class="sw-verdict" id="sw-verdict"></div>' + errBox + '</div>' +
            '<div class="sw-columns"><div class="sw-col"><div class="sw-title pros">Почему стоит ✓</div><ul class="sw-list">' + a.pros.map(function(p, i){ return '<li style="animation-delay:' + (i * 0.05) + 's">' + esc(p) + '</li>'; }).join('') + '</ul></div>' +
            '<div class="sw-col"><div class="sw-title cons">Почему не стоит ✗</div><ul class="sw-list">' + a.cons.map(function(c, i){ return '<li style="animation-delay:' + (i * 0.05) + 's">' + esc(c) + '</li>'; }).join('') + '</ul></div></div>' +
            '<div class="sw-target-audience"><div class="sw-title target">Кому посмотреть? 🎯</div><div>' + esc(a.audience) + '</div></div>';
    }
    function bindDice(html) {
        html.find('#sw-dice-btn').on('hover:enter click keydown', function(e) {
            try {
                if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                if (window._sw_rolling) return; window._sw_rolling = true;
                var btn = $(this), v = html.find('#sw-verdict');
                v.attr('style', '').attr('class', 'sw-verdict').text(''); btn.addClass('shake');
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
    }

    function showModal(movie) {
        var title = esc(movie.title || movie.name || 'Фильм');
        try { window._sw_prevController = Lampa.Controller.enabled ? Lampa.Controller.enabled() : null; } catch(e) { window._sw_prevController = null; }
        var phrases = ['Собираю факты о фильме…', 'Читаю синопсис и отзывы…', 'Спрашиваю ИИ-критика…', 'Формирую вердикт…'];
        var html = $('<div class="sw-modal-content"><div id="sw-body"><div class="sw-loader"><div class="sw-loader-dice">🎲</div><div class="sw-loader-text" id="sw-loader-text">' + phrases[0] + '</div><div class="sw-loader-bar"></div></div></div></div>');
        window._sw_currentModalHtml = html;
        var pi = 0;
        window._sw_loaderTimer = setInterval(function() {
            pi = (pi + 1) % phrases.length; var t = html.find('#sw-loader-text');
            if (t.length) { t.css('opacity', 0); setTimeout(function(){ t.text(phrases[pi]).css('opacity', 1); }, 200); }
        }, 800);
        Lampa.Modal.open({
            title: 'Стоит ли смотреть: ' + title, html: html, size: 'large', zIndex: 1000,
            onBack: function() {
                window._sw_rolling = false; window._sw_currentModalHtml = null;
                if (window._sw_loaderTimer) { clearInterval(window._sw_loaderTimer); window._sw_loaderTimer = null; }
                var prev = window._sw_prevController; window._sw_prevController = null;
                try { if (prev && prev.name) Lampa.Controller.toggle(prev.name); else Lampa.Controller.toggle('full_start'); } catch(e) { try { Lampa.Controller.toggle('full'); } catch(_) {} }
            }
        });
        analyze(movie).then(function(a) {
            if (window._sw_loaderTimer) { clearInterval(window._sw_loaderTimer); window._sw_loaderTimer = null; }
            html.find('#sw-body').html('<div class="sw-body">' + buildReadyInner(a) + '</div>');
            bindDice(html);
            Lampa.Controller.toggle('should_watch_modal');
        }).catch(function(err) {
            if (window._sw_loaderTimer) { clearInterval(window._sw_loaderTimer); window._sw_loaderTimer = null; }
            console.error('[SW] analyze:', err);
            html.find('#sw-body').html('<div class="sw-body" style="text-align:center;padding:40px;color:#d9534f">Ошибка анализа</div>');
        });
    }

    function addBtn(el, movie) {
        if (!el || !el.length || el.find('.sw-custom-button').length) return;
        var btn = $('<div class="full-start__button selector sw-custom-button" data-type="should_watch"><div class="full-start__icon">' + ICON + '</div><span>Стоит ли?</span></div>');
        btn.on('hover:enter', function() { if (movie) showModal(movie); });
        var anchor = el.find('.view--torrent,.view--online,.view--trailer').last();
        if (anchor.length) anchor.after(btn);
        else { var fb = el.find('.full-start__buttons,.full-start-new__buttons,.full-card__buttons'); if (fb.length) fb.append(btn); }
    }

    function startPlugin() {
        try { ensureDefaults(); } catch(e) {}
        try { registerController(); } catch(e) {}
        try { Lampa.Listener.follow('full', function(e) { if (e.type !== 'complite') return; try { addBtn(e.object.activity.render(), e.data.movie); } catch(err) { console.error('[SW]', err); } }); } catch(e) {}
        try { initSettings(); } catch(e) {}
        try { injectCSS(); } catch(e) {}
        console.log('[ShouldWatch] v15.0 (field-mix guard + defaults fix).');
    }
    try { if (window.appready) startPlugin(); else Lampa.Listener.follow('app', function(e){ if (e.type === 'ready') startPlugin(); }); } catch(e) {}
})();
