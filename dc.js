(function () {
    'use strict';

    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;

    var PLUGIN_ID = 'should_watch_plugin';
    var ICON = '<svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="8" stroke-linecap="square" fill="none"><path d="M20,55 L40,75 L80,25"/><path d="M25,25 L75,75" stroke-dasharray="4,4"/></g></svg>';

    window._sw_rolling = false;
    window._sw_currentModalHtml = null;
    window._sw_prevController = null;
    var _extraCache = {};
    var _aiCache = {};

    /* ==========================================================================
       НАСТРОЙКИ
       ========================================================================== */

    function getSetting(key, def) {
        try { var v = Lampa.Storage.get(PLUGIN_ID + '_' + key); if (v !== undefined && v !== null && v !== '') return v; } catch(e) {}
        return def;
    }
    function saveSetting(key, value) { try { Lampa.Storage.set(PLUGIN_ID + '_' + key, value); } catch(e) {} }
    function getSettings() {
        return {
            bad_genres: String(getSetting('bad_genres', '') || ''),
            bad_actors: String(getSetting('bad_actors', '') || ''),
            bad_directors: String(getSetting('bad_directors', '') || ''),
            min_rating: parseFloat(getSetting('min_rating', '6')) || 6,
            gemini_key: String(getSetting('gemini_key', '') || '').trim(),
            ai_mode: String(getSetting('ai_mode', 'hybrid') || 'hybrid')
        };
    }
    function parseBL(str) { return str ? str.split(',').map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean) : []; }
    function initSettings() {
        if (!window.Lampa || !Lampa.SettingsApi || window.sw_settings_ready) return;
        window.sw_settings_ready = true;
        Lampa.SettingsApi.addComponent({ component: PLUGIN_ID, name: 'Стоит ли смотреть?', icon: ICON });
        [
            { name: 'gemini_key', type: 'input', title: 'API-ключ Gemini', description: 'Получить: aistudio.google.com/apikey', default: '' },
            { name: 'ai_mode', type: 'select', title: 'Режим анализа', values: {'hybrid':'ИИ + теги (рекомендуется)','ai_only':'Только ИИ','tags_only':'Только теги TMDB'}, default: 'hybrid' },
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

    /* ==========================================================================
       СТИЛИ
       ========================================================================== */

    function injectCSS() {
        if (document.getElementById('sw-plugin-styles')) return;
        var s = document.createElement('style');
        s.id = 'sw-plugin-styles';
        s.innerHTML =
            '.sw-modal-content{padding:20px;color:#fff;font-family:sans-serif;max-height:72vh;overflow-y:auto;scroll-behavior:smooth;animation:swFade .25s ease}' +
            '.sw-modal-content::-webkit-scrollbar{width:5px}' +
            '.sw-modal-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:3px}' +
            '.sw-mode-badge{display:inline-block;font-size:.75em;padding:3px 10px;border-radius:10px;margin-left:10px;vertical-align:middle;font-weight:600;letter-spacing:.05em;text-transform:uppercase}' +
            '.sw-mode-badge.ai{background:#4285f4;color:#fff}' +
            '.sw-mode-badge.tags{background:rgba(255,255,255,.15);color:#ccc}' +
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
            '.sw-list{margin:0;padding-left:20px;font-size:.95em;line-height:1.5;color:#ccc}' +
            '.sw-list li{margin-bottom:10px}' +
            '.sw-target-audience{background:rgba(255,255,255,.05);padding:20px;border-radius:10px;line-height:1.6;color:#ddd;font-size:1.05em}' +
            '@keyframes swShake{0%,100%{transform:translate(1px,-2px) rotate(-1deg)}10%,30%,50%,70%,90%{transform:translate(-1px,2px) rotate(1deg)}20%,40%,60%,80%{transform:translate(-3px,0) rotate(0deg)}}' +
            '@keyframes swFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}';
        document.head.appendChild(s);
    }

    /* ==========================================================================
       УТИЛИТЫ
       ========================================================================== */

    function esc(s) { return typeof s === 'string' ? $('<div>').text(s).html() : ''; }
    function hasGenre(g, re) { return g.some(function(x){ return re.test(x); }); }
    function inText(s, re) { return re.test((s || '').toLowerCase()); }
    function mediaType(m) { return (m && m.name && !m.title) ? 'tv' : 'movie'; }

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

    /* ==========================================================================
       GEMINI API
       ========================================================================== */

    function analyzeWithGemini(movie) {
        var key = getSettings().gemini_key;
        if (!key) return Promise.resolve(null);
        var id = movie.id || movie.tmdb_id;
        if (id && _aiCache[id]) return Promise.resolve(_aiCache[id]);

        var title = movie.title || movie.name || '';
        var year = (movie.release_date || movie.first_air_date || '').substring(0, 4);
        var genres = (movie.genres || []).map(function(g){ return g.name; }).join(', ');
        var overview = (movie.overview || '').substring(0, 1000);
        var rating = parseFloat(movie.vote_average) || 0;
        var votes = parseInt(movie.vote_count) || 0;

        var prompt = 'Проанализируй фильм/сериал "' + title + '" (' + year + ').\n' +
            'Жанры: ' + genres + '\n' +
            'Синопсис: ' + overview + '\n' +
            'Рейтинг: ' + rating + '/10 (' + votes + ' голосов)\n\n' +
            'Верни ТОЛЬКО валидный JSON (без markdown, без пояснений):\n' +
            '{\n' +
            '  "family_friendly": true или false,\n' +
            '  "drugs": true или false,\n' +
            '  "violence": true или false,\n' +
            '  "smoking_alcohol": true или false,\n' +
            '  "explicit": true или false,\n' +
            '  "hate_speech": true или false,\n' +
            '  "age_restriction": "0+" или "6+" или "12+" или "16+" или "18+",\n' +
            '  "pros": ["плюс1", "плюс2"],\n' +
            '  "cons": ["минус1", "минус2"],\n' +
            '  "audience": "кому подходит"\n' +
            '}';

        return new Promise(function(res) {
            try {
                if (typeof fetch === 'undefined') return res(null);
                fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.3,
                            topK: 40,
                            topP: 0.95,
                            maxOutputTokens: 1024
                        }
                    })
                })
                .then(function(r){ return r.json(); })
                .then(function(data) {
                    try {
                        if (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
                            var text = data.candidates[0].content.parts[0].text || '';
                            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
                            var json = JSON.parse(text);
                            if (id) _aiCache[id] = json;
                            res(json);
                        } else {
                            res(null);
                        }
                    } catch(e) { res(null); }
                })
                .catch(function(){ res(null); });
            } catch(e) { res(null); }
        });
    }

    /* ==========================================================================
       АНАЛИЗАТОР v10.0 (гибридный: ИИ + теги)
       ========================================================================== */

    function analyze(movie) {
        var cfg = getSettings();
        var useAI = cfg.gemini_key && (cfg.ai_mode === 'hybrid' || cfg.ai_mode === 'ai_only');

        return Promise.all([ loadCredits(movie), loadExtra(movie), useAI ? analyzeWithGemini(movie) : Promise.resolve(null) ]).then(function(arr) {
            var credits = arr[0], extra = arr[1], aiResult = arr[2];
            var blG = parseBL(cfg.bad_genres), blA = parseBL(cfg.bad_actors), blD = parseBL(cfg.bad_directors);

            var q = (movie.quality || movie.source_quality || '').toString().toUpperCase();
            var rating = parseFloat(movie.vote_average) || 0;
            var votes = parseInt(movie.vote_count) || 0;
            var runtime = parseInt(movie.runtime) || 0;
            var genres = (movie.genres || []).map(function(g){ return g.name; }).filter(Boolean);
            var ov = (movie.overview || '').trim();
            var age = extra.age;

            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){ return c.name; }).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){ return c.job === 'Director'; }).map(function(c){ return c.name; }).filter(Boolean);
            var wrts = crew.filter(function(c){ return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0; }).map(function(c){ return c.name; }).filter(Boolean);

            var ctx = { kw: extra.kw };

            // Если ИИ вернул результат, используем его
            if (aiResult) {
                var P = [], C = [];

                // Плюсы от ИИ
                if (aiResult.pros && Array.isArray(aiResult.pros)) {
                    aiResult.pros.forEach(function(p){ if (p && typeof p === 'string') P.push(p); });
                }

                // Минусы от ИИ
                if (aiResult.cons && Array.isArray(aiResult.cons)) {
                    aiResult.cons.forEach(function(c){ if (c && typeof c === 'string') C.push(c); });
                }

                // Флаги от ИИ -> эмодзи-минусы
                if (aiResult.drugs) C.push('💉 употребление наркотиков');
                if (aiResult.violence) C.push('🔪 жестокие сцены');
                if (aiResult.smoking_alcohol) C.push('🚬 курение или употребление алкоголя');
                if (aiResult.explicit) C.push('💋 откровенные сцены');
                if (aiResult.hate_speech) C.push('🚩 разжигание ненависти');

                // Возрастной ценз от ИИ
                if (aiResult.age_restriction && aiResult.age_restriction !== '0+') {
                    C.push('🔞 возрастной ценз ' + aiResult.age_restriction + ' — не для детей');
                }

                // Семейный от ИИ
                if (aiResult.family_friendly && !aiResult.drugs && !aiResult.violence && !aiResult.smoking_alcohol && !aiResult.explicit) {
                    P.push('🤱 подойдет для семейного просмотра');
                }

                // Чёрные списки -> в МИНУСЫ
                var mG = genres.filter(function(g){ var gl = g.toLowerCase(); return blG.some(function(b){ return gl.indexOf(b) >= 0; }); });
                var mA = cast.filter(function(a){ var al = a.toLowerCase(); return blA.some(function(b){ return al.indexOf(b) >= 0; }); });
                var mD = [].concat(dirs, wrts).filter(function(p){ var pl = p.toLowerCase(); return blD.some(function(b){ return pl.indexOf(b) >= 0; }); });
                if (mG.length) C.push('⛔ Нелюбимый жанр: ' + mG.join(', '));
                if (mA.length) C.push('⛔ Нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '));
                if (mD.length) C.push('⛔ Нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '));

                if (!P.length) P.push('ℹ️ Недостаточно метаданных');
                if (!C.length) C.push('✅ Противопоказаний не выявлено');

                var audience = aiResult.audience && typeof aiResult.audience === 'string' ? aiResult.audience : 'Любителям кино без особых предпочтений.';

                return { pros: P, cons: C, audience: audience, mode: 'AI' };
            }

            // Фолбэк на теги TMDB (как в v9.3)
            var fDrugs   = inText(ov, /метамфетамин|варк|meth|кокаин|cocaine|героин|heroin|наркот|марихуан|каннабис|опиум|амфетамин/) || hasKw(ctx, /drug|narcotic|addiction|meth|cocaine|heroin|marijuan|substance/);
            var fViol    = inText(ov, /violenc|gore|murder|убийств|кров|жесток|насил|оружи|стрельб/) || hasKw(ctx, /violenc|gore|murder|blood|tortur|brutal|weapon|gun|fight/) || hasGenre(genres, /horror|ужас/i) || (hasGenre(genres, /crime|криминал/i) && hasGenre(genres, /thriller|триллер/i));
            var fSmoke   = inText(ov, /smok|alcohol|\bdrink\b|пьян|курени|выпив/) || hasKw(ctx, /smok|cigarette|alcohol|drink|drunk|bar/);
            var fSex     = !!movie.adult || inText(ov, /\bsex\b|nudity|обнаж|эротик|откровен/) || hasKw(ctx, /nudity|sex|sexual|erotic|stripper|prostitut/);
            var fHate    = inText(ov, /hate|racis|нацист|расизм|ненавист/) || hasKw(ctx, /racis|nazi|homophob/);
            var fAdultAge = (age !== null && age >= 16);
            var anyAdult = fDrugs || fViol || fSmoke || fSex || fHate || !!movie.adult || fAdultAge;

            var famGenre = hasGenre(genres, /family|animation|семейн|мульт|детск/i);
            var kidsKw = hasKw(ctx, /for kids|children|\bkids\b|family/);
            var lowAge = (age !== null && age <= 12);
            var familyOK = (famGenre || kidsKw) && !anyAdult && (lowAge || age === null) && rating >= 6;

            var P = [], C = [];

            if (rating >= cfg.min_rating && votes >= 100) P.push('⭐ высокий рейтинг (' + rating.toFixed(1) + ')');
            if (inText(ov, /soundtrack|music|composer|score|музык|композитор/) || hasKw(ctx, /music|soundtrack|composer/)) P.push('🎵 хорошая музыкальная составляющая');
            if (hasGenre(genres, /action|боевик/i)) P.push('💥 впечатляющие экшен-сцены');
            if (familyOK) P.push('🤱 подойдет для семейного просмотра');
            if (hasGenre(genres, /documentary|документ/i)) P.push('🦫 полезная информация');
            if (q && !/CAM|TS|HDCAM|SCR|WORKPRINT/i.test(q)) P.push('🎥 отличное качество видео (' + (q || 'HD') + ')');
            if (runtime > 0 && runtime <= 130) P.push('🕐 комфортный хронометраж (' + runtime + ' мин.)');
            if ((movie.origin_country || []).length > 2) P.push('🏳️ дружба народов');
            if (rating >= 8.0 && votes >= 3000) P.push('🔎 находка — в числе лучших по оценкам');
            var yr = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : 0;
            if (yr >= new Date().getFullYear() - 1) P.push('🔥 горячие новинки');
            if (age !== null && age <= 12 && !familyOK) P.push('👶 низкий возрастной ценз (' + age + '+)');

            var mG = genres.filter(function(g){ var gl = g.toLowerCase(); return blG.some(function(b){ return gl.indexOf(b) >= 0; }); });
            var mA = cast.filter(function(a){ var al = a.toLowerCase(); return blA.some(function(b){ return al.indexOf(b) >= 0; }); });
            var mD = [].concat(dirs, wrts).filter(function(p){ var pl = p.toLowerCase(); return blD.some(function(b){ return pl.indexOf(b) >= 0; }); });
            if (mG.length) C.push('⛔ Нелюбимый жанр: ' + mG.join(', '));
            if (mA.length) C.push('⛔ Нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '));
            if (mD.length) C.push('⛔ Нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '));

            if (fSex) C.push('💋 откровенные сцены');
            if (fSmoke) C.push('🚬 курение или употребление алкоголя');
            if (inText(ov, /casino|gambl|казино|ставк|\bbet\b|рулетк/) || hasKw(ctx, /casino|gambl|betting/)) C.push('🎰 игромания');
            if (fViol) C.push('🔪 жестокие сцены');
            if (runtime > 180) C.push('⌛ высокий хронометраж (' + runtime + ' мин.)');
            if (fDrugs) C.push('💉 употребление наркотиков');
            if (/CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT/i.test(q || '')) C.push('📺 низкое качество видео (' + q + ')');
            if (fHate) C.push('🚩 разжигание ненависти');
            if (age !== null && age >= 16) C.push('🔞 возрастной ценз ' + age + '+ — не для детей');

            if (!P.length) P.push('ℹ️ Недостаточно метаданных');
            if (!C.length) C.push('✅ Противопоказаний не выявлено');

            var AW = [
                { w: 'экшена', t: hasGenre(genres, /action|боевик/i) },
                { w: 'качества картинки', t: q && !/CAM|TS|HDCAM|SCR/i.test(q) },
                { w: 'хорошей музыки', t: inText(ov, /soundtrack|music|composer|score|музык/) },
                { w: 'полезного времяпровождения', t: hasGenre(genres, /documentary|документ/i) },
                { w: 'испытать свои нервы', t: hasGenre(genres, /thriller|horror|триллер|ужас/i) },
                { w: 'семейного вечера', t: familyOK },
                { w: 'новинки', t: yr >= new Date().getFullYear() - 1 },
                { w: 'драмы', t: hasGenre(genres, /drama|драма/i) },
                { w: 'комедии', t: hasGenre(genres, /comedy|комед/i) },
                { w: 'фантастики', t: hasGenre(genres, /sci-fi|fantasy|фантастик/i) }
            ];
            var matched = AW.filter(function(x){ return x.t; }).map(function(x){ return x.w; });
            var audience = matched.length
                ? 'Любителям ' + matched.slice().sort(function(){ return Math.random() - 0.5; }).join(', ') + '.'
                : 'Любителям кино без особых предпочтений.';

            return { pros: P, cons: C, audience: audience, mode: 'TAGS' };
        });
    }

    /* ==========================================================================
       КОНТРОЛЛЕР
       ========================================================================== */

    function registerController() {
        Lampa.Controller.add('should_watch_modal', {
            toggle: function() {
                var h = window._sw_currentModalHtml;
                if (h) { Lampa.Controller.collectionSet(h); var b = h.find('#sw-dice-btn'); if (b.length) Lampa.Controller.collectionFocus(b); }
            },
            up: function() { var h = window._sw_currentModalHtml; if (h && h[0] && h[0].scrollTop > 0) h[0].scrollBy({ top: -120, behavior: 'smooth' }); },
            down: function() { var h = window._sw_currentModalHtml; if (h && h[0]) h[0].scrollBy({ top: 120, behavior: 'smooth' }); },
            left: function() {},
            right: function() {},
            back: function() {
                window._sw_rolling = false; window._sw_currentModalHtml = null;
                var prev = window._sw_prevController; window._sw_prevController = null;
                try { Lampa.Modal.close(); } catch(e) {}
                try { if (prev && prev.name) Lampa.Controller.toggle(prev.name); else Lampa.Controller.toggle('full_start'); }
                catch(e) { try { Lampa.Controller.toggle('full'); } catch(_) {} }
            }
        });
    }

    /* ==========================================================================
       МОДАЛКА
       ========================================================================== */

    function showModal(movie) {
        var title = esc(movie.title || movie.name || 'Фильм');
        try { window._sw_prevController = Lampa.Controller.enabled ? Lampa.Controller.enabled() : null; } catch(e) { window._sw_prevController = null; }
        try { Lampa.Loading.start(); } catch(e) {}

        analyze(movie).then(function(a) {
            try { Lampa.Loading.stop(); } catch(e) {}
            var badge = a.mode === 'AI' ? '<span class="sw-mode-badge ai">AI</span>' : '<span class="sw-mode-badge tags">TAGS</span>';
            var html = $(
                '<div class="sw-modal-content">' +
                    '<div class="sw-dice-section">' +
                        '<div class="sw-dice-btn selector" id="sw-dice-btn"><span style="font-size:1.5em">🎲</span> Бросить кости' + badge + '</div>' +
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
                try {
                    if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                    if (window._sw_rolling) return;
                    window._sw_rolling = true;
                    var btn = $(this), v = html.find('#sw-verdict');
                    v.attr('style', '').attr('class', 'sw-verdict').text('');
                    btn.addClass('shake');
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

            Lampa.Modal.open({
                title: 'Стоит ли смотреть: ' + title,
                html: html,
                size: 'large',
                zIndex: 1000,
                onBack: function() {
                    window._sw_rolling = false; window._sw_currentModalHtml = null;
                    var prev = window._sw_prevController; window._sw_prevController = null;
                    try { if (prev && prev.name) Lampa.Controller.toggle(prev.name); else Lampa.Controller.toggle('full_start'); }
                    catch(e) { try { Lampa.Controller.toggle('full'); } catch(_) {} }
                }
            });
            Lampa.Controller.toggle('should_watch_modal');
        }).catch(function(err) {
            try { Lampa.Loading.stop(); } catch(e) {}
            console.error('[SW] analyze:', err);
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
        else { var fb = el.find('.full-start__buttons,.full-start-new__buttons,.full-card__buttons'); if (fb.length) fb.append(btn); }
    }

    /* ==========================================================================
       ЗАПУСК
       ========================================================================== */

    function startPlugin() {
        try { registerController(); } catch(err) {}
        try {
            Lampa.Listener.follow('full', function(e) {
                if (e.type !== 'complite') return;
                try { addBtn(e.object.activity.render(), e.data.movie); } catch(err) { console.error('[SW]', err); }
            });
        } catch(err) {}
        try { initSettings(); } catch(err) {}
        try { injectCSS(); } catch(err) {}
        console.log('[ShouldWatch] v10.0 initialized (Gemini AI integration).');
    }

    try {
        if (window.appready) startPlugin();
        else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') startPlugin(); });
    } catch(e) {}

})();
