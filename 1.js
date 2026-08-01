/* ============================================================
   MULTIPLEX v3 — замена главной + мульти-источниковый поиск
   Интеграция строго по API Lampa (проверено на surs.js v3):
     Lampa.Api.sources / Lampa.Api.partNext / Lampa.SettingsApi /
     Lampa.ContentRows / Lampa.Activity / Lampa.Lang / Lampa.Reguest
   НЕ используются несуществующие методы. Главная строится через
   источник.main + partNext (штатные карточки, рабочий пульт).
   ============================================================ */
(function () {
    'use strict';

    /* ---------- polyfill assign ---------- */
    function assign(target) {
        for (var i = 1; i < arguments.length; i++) {
            var src = arguments[i];
            if (src) for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
        }
        return target;
    }

    var NAME = 'multiplex';                 // ключ источника в Lampa.Api.sources
    var PROFILE_KEY = 'lampac_profile_id';  // как в surs

    /* ---------- конфигурация (хранится в Storage) ---------- */
    var DEFAULTS = {
        mode: 'auto',            // auto | main | rus | kids  (режим главной)
        radius: 8,               // скругление карточек (px), как в CUB-стиле
        streams_on_main: 'all',  // all | ru | foreign | off
        anti_dup: 'on',          // on | off  (анти-дубль постеров)
        adapters: {
            tmdb:   { enabled: 'on', label: 'TMDB',          key: '', priority: 100, w_ru: 60,  w_for: 100 },
            kp:     { enabled: 'on', label: 'Кинопоиск',     key: '', priority: 90,  w_ru: 100, w_for: 50  },
            omdb:   { enabled: 'on', label: 'OMDb / IMDb',   key: '', priority: 70,  w_ru: 30,  w_for: 75  },
            trakt:  { enabled: 'on', label: 'Trakt',         key: '7a4f4a40096c3491ec8be46d9f00c4f8b3ce43b1c0c86f42f30dc5f1839a1670', priority: 80, w_ru: 40, w_for: 90 },
            fanart: { enabled: 'on', label: 'Fanart.tv',     key: '', priority: 50,  w_ru: 80,  w_for: 90  }
        },
        // веса рекомендаций: жанры > теги > актёры = режиссёры > хронометраж
        weights: { genre: 0.35, tag: 0.20, actor: 0.15, director: 0.15, runtime: 0.05, rating: 0.05, year: 0.03, country: 0.02 },
        streams: {
            ru: [
                { id: 'kp',     title: 'Кинопоиск', pid: 115, region: 'RU' },
                { id: 'ivi',    title: 'IVI',       pid: 113, region: 'RU' },
                { id: 'okko',   title: 'Okko',      pid: 116, region: 'RU' },
                { id: 'start',  title: 'START',     pid: 118, region: 'RU' }
            ],
            foreign: [
                { id: 'appletv', title: 'Apple TV+', pid: 350, region: 'US' },
                { id: 'disney',  title: 'Disney+',   pid: 337, region: 'US' },
                { id: 'netflix', title: 'Netflix',   pid: 8,   region: 'US' }
            ]
        },
        top_genres: [28, 35, 18, 878, 27, 53] // ряды «по жанрам» на главной
    };

    function cfg() {
        var c = Lampa.Storage.get('mpx_cfg', null);
        if (!c) { Lampa.Storage.set('mpx_cfg', DEFAULTS); return DEFAULTS; }
        // докидываем новые поля из DEFAULTS (миграция)
        return assign({}, DEFAULTS, c, { adapters: assign({}, DEFAULTS.adapters, c.adapters || {}), weights: assign({}, DEFAULTS.weights, c.weights || {}), streams: assign({}, DEFAULTS.streams, c.streams || {}) });
    }
    function saveCfg(c) { Lampa.Storage.set('mpx_cfg', c); }
    function isOn(adapter) { var a = cfg().adapters[adapter]; return a && a.enabled === 'on'; }

    /* ---------- утилиты ---------- */
    var U = {
        log: function () { var a = ['[MULTIPLEX]'].concat([].slice.call(arguments)); try { console.log.apply(console, a); } catch (e) {} },
        req: function (url, headers, ok, err) {
            try {
                var r = new Lampa.Reguest();
                r.native(url, function (d) { if (ok) ok(d); }, function (x, y) { U.log('req err', url); if (err) err(x, y); }, headers ? { headers: headers } : {});
                return r;
            } catch (e) { U.log('req throw', e); if (err) err(e); }
        },
        profile: function () { try { return Lampa.Storage.get(PROFILE_KEY, '') || 'default'; } catch (e) { return 'default'; } },
        // режим с учётом профиля (как в surs: forKids/onlyRus)
        mode: function () {
            var m = cfg().mode;
            if (m && m !== 'auto') return m;
            try {
                var p = Lampa.Storage.get('profile', null);
                if (p && p.params) {
                    if (p.params.forKids) return 'kids';
                    if (p.params.onlyRus) return 'rus';
                }
            } catch (e) {}
            return 'main';
        },
        // интерливинг массивов (чтобы источники чередовались, а не шли блоками)
        interleave: function (arrs) {
            var out = [], max = 0;
            for (var i = 0; i < arrs.length; i++) if (arrs[i] && arrs[i].length > max) max = arrs[i].length;
            for (var p = 0; p < max; p++) for (var s = 0; s < arrs.length; s++) if (arrs[s] && arrs[s][p]) out.push(arrs[s][p]);
            return out;
        },
        // анти-дубль: по imdb/tmdb + хеш постера (нормализуем размер в url)
        dedup: function (items) {
            var seen = {}, posters = {}, out = [];
            var anti = cfg().anti_dup === 'on';
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                var key = it.imdb_id || (it.tmdb_id ? 't' + it.tmdb_id : '') || (it.id ? 'i' + it.id : '');
                if (!key) key = (it.title || it.name || '') + '_' + (it.year || '');
                if (seen[key]) continue;
                if (anti && it.poster_path) {
                    var ph = String(it.poster_path).replace(/\/w\d+\//, '/').replace(/\/original\//, '/');
                    if (posters[ph]) continue;
                    posters[ph] = 1;
                }
                seen[key] = 1; out.push(it);
            }
            return out;
        },
        // параллельный запуск адаптеров, мердж результатов
        runAll: function (list, fn, done) {
            var results = [], left = list.length;
            if (!left) { done([]); return; }
            list.forEach(function (name, idx) {
                fn(name, function (res) { results[idx] = res || []; if (--left <= 0) done(U.interleave(results)); });
            });
        },
        // цепочка с fallback (умный выбор: первый, кто дал результат)
        runChain: function (list, fn, done) {
            var i = 0;
            (function next() {
                if (i >= list.length) { done([]); return; }
                var name = list[i++];
                fn(name, function (res) { if (res && res.length) done(res); else next(); }, next);
            })();
        },
        // ранжированный список адаптеров под задачу (скоринг качества/кол-ва/успеха)
        chain: function (task) {
            var c = cfg(), arr = [];
            for (var n in c.adapters) {
                var a = c.adapters[n];
                if (a.enabled !== 'on') continue;
                var sc = a.priority + (task === 'ru' ? a.w_ru : a.w_for);
                var st = STATS[n];
                if (st && st.ok + st.fail > 0) sc *= (st.ok / (st.ok + st.fail));
                arr.push({ n: n, sc: sc });
            }
            arr.sort(function (x, y) { return y.sc - x.sc; });
            return arr.map(function (o) { return o.n; });
        },
        // бейдж качества в стиле CUB (best-effort через emit.onCreate)
        qualityOf: function (it) {
            if (it.quality) return it.quality;
            return '';
        },
        // навесить на карточку onCreate для CUB-бейджа + источника
        decorate: function (card, sourceLabel) {
            card.params = card.params || {};
            var q = U.qualityOf(card);
            card.params.emit = assign({}, card.params.emit || {}, {
                onCreate: function () {
                    try {
                        var view = this.html.find('.card__view');
                        if (q && !view.find('.mpx-q').length) {
                            view.append('<div class="mpx-q mpx-q--' + String(q).toLowerCase() + '">' + q + '</div>');
                        }
                        if (sourceLabel && !view.find('.mpx-src').length) {
                            view.append('<div class="mpx-src">' + sourceLabel + '</div>');
                        }
                    } catch (e) {}
                }
            });
            return card;
        }
    };

    var STATS = {}; // статистика успешности адаптеров
    function stat(name, ok) { if (!STATS[name]) STATS[name] = { ok: 0, fail: 0 }; if (ok) STATS[name].ok++; else STATS[name].fail++; }

    /* ============================================================
       АДАПТЕРЫ (маппинг ВСЕГДА в tmdb-поля: poster_path/backdrop_path!)
    ============================================================ */
    var A = {
        tmdb: {
            key: function () { return cfg().adapters.tmdb.key || Lampa.Storage.get('mpx_tmdb_key', ''); },
            url: function (p, ex) { return 'https://api.themoviedb.org/3' + p + '?api_key=' + this.key() + '&language=ru-RU' + (ex || ''); },
            map: function (arr, src) {
                var self = this;
                return (arr || []).map(function (it) {
                    return {
                        source: src || 'tmdb', id: it.id, tmdb_id: it.id, imdb_id: it.imdb_id || '',
                        title: it.title || it.name || '', name: it.name || it.title || '',
                        original_title: it.original_title || it.original_name || '', original_name: it.original_name || it.original_name || '',
                        overview: it.overview || '', media_type: it.media_type || (it.first_air_date ? 'tv' : 'movie'),
                        poster_path: it.poster_path || '', backdrop_path: it.backdrop_path || '',
                        vote_average: it.vote_average || 0, vote_count: it.vote_count || 0, popularity: it.popularity || 0,
                        release_date: it.release_date || it.first_air_date || '', year: String((it.release_date || it.first_air_date || '').slice(0, 4)),
                        genre_ids: it.genre_ids || []
                    };
                });
            },
            get: function (path, ex, cb) { var self = this; U.req(this.url(path, ex), null, function (d) { stat('tmdb', true); cb(self.map(d.results || d.items || [], 'tmdb')); }, function () { stat('tmdb', false); cb([]); }); },
            trending: function (cb) { this.get('/trending/all/week', '', cb); },
            popular: function (cb) { var self = this; U.runAll(['m', 't'], function (t, d) { self.get('/' + (t === 'm' ? 'movie' : 'tv') + '/popular', '', d); }, function (r) { cb(U.dedup(U.interleave(r))); }); },
            top: function (cb) { this.get('/movie/top_rated', '', cb); },
            revenue: function (cb) { this.get('/discover/movie', '&sort_by=revenue.desc&primary_release_date.lte=' + new Date().toISOString().slice(0, 10), cb); },
            now: function (cb) { this.get('/movie/now_playing', '', cb); },
            genre: function (gid, cb) { this.get('/discover/movie', '&with_genres=' + gid + '&sort_by=popularity.desc', cb); },
            stream: function (pid, region, cb) { this.get('/discover/movie', '&with_watch_providers=' + pid + '&watch_region=' + (region || 'RU') + '&sort_by=popularity.desc', cb); }
        },
        kp: {
            key: function () { return cfg().adapters.kp.key || Lampa.Storage.get('mpx_kp_key', ''); },
            h: function () { return { 'X-API-KEY': this.key() }; },
            map: function (arr) {
                return (arr || []).map(function (it) {
                    return {
                        source: 'kp', kp_id: it.kinopoiskId || it.filmId || it.id, id: it.kinopoiskId || it.filmId || it.id,
                        imdb_id: it.imdbId || '', title: it.nameRu || it.nameEn || it.nameOriginal || '', name: it.nameRu || it.nameEn || '',
                        original_title: it.nameEn || it.nameOriginal || '', overview: it.description || '',
                        poster_path: it.posterUrl || it.posterUrlPreview || '', backdrop_path: it.coverUrl || '',
                        vote_average: it.ratingKinopoisk || it.rating || 0, popularity: it.rating || 0,
                        year: String(it.year || ''), release_date: it.year ? it.year + '-01-01' : '',
                        media_type: it.type === 'TV_SERIES' ? 'tv' : 'movie',
                        genre_ids: (it.genres || []).map(function (g) { return g.genre || g; })
                    };
                });
            },
            search: function (q, cb) { var self = this; U.req('https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword?keyword=' + encodeURIComponent(q) + '&page=1', this.h(), function (d) { stat('kp', true); cb(self.map(d.films || [])); }, function () { stat('kp', false); cb([]); }); },
            top: function (cb) { var self = this; U.req('https://kinopoiskapiunofficial.tech/api/v2.2/films/top?type=TOP_100_POPULAR_FILMS&page=1', this.h(), function (d) { stat('kp', true); cb(self.map(d.films || [])); }, function () { stat('kp', false); cb([]); }); },
            top250: function (cb) { var self = this; U.req('https://kinopoiskapiunofficial.tech/api/v2.2/films/top?type=TOP_250_BEST_FILMS&page=1', this.h(), function (d) { stat('kp', true); cb(self.map(d.films || [])); }, function () { stat('kp', false); cb([]); }); }
        },
        omdb: {
            key: function () { return cfg().adapters.omdb.key || Lampa.Storage.get('mpx_omdb_key', ''); },
            map: function (arr) {
                return (arr || []).map(function (it) {
                    return {
                        source: 'omdb', imdb_id: it.imdbID || '', id: it.imdbID || '', title: it.Title || '', name: it.Title || '',
                        original_title: it.Title || '', poster_path: (it.Poster && it.Poster !== 'N/A') ? it.Poster : '',
                        year: String(it.Year || '').slice(0, 4), release_date: it.Year || '', media_type: it.Type === 'series' ? 'tv' : 'movie',
                        vote_average: 0, genre_ids: []
                    };
                });
            },
            search: function (q, cb) { var k = this.key(); if (!k) { cb([]); return; } var self = this; U.req('https://www.omdbapi.com/?s=' + encodeURIComponent(q) + '&apikey=' + k, null, function (d) { stat('omdb', true); cb(self.map(d && d.Search ? d.Search : [])); }, function () { stat('omdb', false); cb([]); }); }
        },
        trakt: {
            h: function () { return { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': cfg().adapters.trakt.key }; },
            map: function (arr) {
                return (arr || []).map(function (it) {
                    var m = it.movie || it.show || it;
                    return {
                        source: 'trakt', imdb_id: (m.ids && m.ids.imdb) || '', tmdb_id: (m.ids && m.ids.tmdb) || null, id: (m.ids && m.ids.trakt) || '',
                        title: m.title || '', name: m.title || '', original_title: m.title || '', year: String(m.year || ''),
                        poster_path: '', backdrop_path: '', vote_average: 0, popularity: it.watcher_count || it.watchers || 0,
                        media_type: it.movie ? 'movie' : 'tv', genre_ids: []
                    };
                });
            },
            trending: function (cb) { var self = this; U.req('https://api.trakt.tv/movies/trending?limit=30', this.h(), function (d) { stat('trakt', true); cb(self.map(d || [])); }, function () { stat('trakt', false); cb([]); }); },
            popular: function (cb) { var self = this; U.req('https://api.trakt.tv/movies/popular?limit=30', this.h(), function (d) { stat('trakt', true); cb(self.map(d || [])); }, function () { stat('trakt', false); cb([]); }); }
        }
    };

    /* ============================================================
       РЕКОМЕНДАТЕЛЬНЫЙ ДВИЖОК «Интересно лично вам»
    ============================================================ */
    var Rec = {
        HK: 'mpx_history', PK: 'mpx_prefs',
        add: function (o) {
            var h = Lampa.Storage.get(this.HK, []) || [];
            h.unshift(o); if (h.length > 300) h = h.slice(0, 300);
            Lampa.Storage.set(this.HK, h); this.rebuild();
        },
        rebuild: function () {
            var h = Lampa.Storage.get(this.HK, []) || []; if (!h.length) return;
            var p = { genres: {}, tags: {}, actors: {}, directors: {}, rt: [], rat: [], yr: [], countries: {} };
            for (var i = 0; i < h.length; i++) {
                var x = h[i], w = 1 - (i / h.length) * 0.5;
                (x.genre_ids || []).forEach(function (g) { p.genres[g] = (p.genres[g] || 0) + w; });
                (x.tags || []).forEach(function (t) { p.tags[t] = (p.tags[t] || 0) + w; });
                (x.actors || []).forEach(function (a) { p.actors[a] = (p.actors[a] || 0) + w; });
                (x.directors || []).forEach(function (d) { p.directors[d] = (p.directors[d] || 0) + w; });
                if (x.runtime) p.rt.push(x.runtime);
                if (x.vote_average) p.rat.push(x.vote_average);
                if (x.year) p.yr.push(parseInt(x.year, 10));
                if (x.country) p.countries[x.country] = (p.countries[x.country] || 0) + w;
            }
            var avg = function (a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0; };
            p.avg_rt = Math.round(avg(p.rt)); p.avg_rat = avg(p.rat); p.avg_yr = Math.round(avg(p.yr));
            var top = function (o, n) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, n); };
            p.tg = top(p.genres, 8); p.tt = top(p.tags, 10); p.ta = top(p.actors, 15); p.td = top(p.directors, 10); p.tc = top(p.countries, 5);
            Lampa.Storage.set(this.PK, p);
        },
        score: function (c) {
            var p = Lampa.Storage.get(this.PK, null); if (!p) return 0; var W = cfg().weights, s = 0;
            if (c.genre_ids && p.tg && p.tg.length) { var mg = 0; for (var i = 0; i < c.genre_ids.length; i++) if (p.tg.indexOf(String(c.genre_ids[i])) !== -1) mg++; s += W.genre * (mg / Math.max(c.genre_ids.length, 1)); }
            if (c.tags && p.tt && p.tt.length) { var mt = 0; for (var t = 0; t < c.tags.length; t++) if (p.tt.indexOf(c.tags[t]) !== -1) mt++; s += W.tag * Math.min(mt / 3, 1); }
            if (c.actors && p.ta && p.ta.length) { var ma = 0; for (var a = 0; a < c.actors.length; a++) if (p.ta.indexOf(c.actors[a]) !== -1) ma++; s += W.actor * Math.min(ma / 3, 1); }
            if (c.directors && p.td && p.td.length) { var md = 0; for (var d = 0; d < c.directors.length; d++) if (p.td.indexOf(c.directors[d]) !== -1) md++; s += W.director * Math.min(md / 2, 1); }
            if (c.runtime && p.avg_rt) s += W.runtime * Math.max(0, 1 - Math.abs(c.runtime - p.avg_rt) / 60);
            if (c.vote_average && p.avg_rat) s += W.rating * Math.max(0, 1 - Math.abs(c.vote_average - p.avg_rat) / 3);
            if (c.year && p.avg_yr) s += W.year * Math.max(0, 1 - Math.abs(parseInt(c.year, 10) - p.avg_yr) / 20);
            if (c.country && p.tc && p.tc.indexOf(c.country) !== -1) s += W.country;
            return s;
        },
        get: function (cb) {
            var p = Lampa.Storage.get(this.PK, null);
            if (!p || !p.tg || !p.tg.length) { // нет истории → популярное
                A.tmdb.popular(function (r) { cb(r.slice(0, 24)); }); return;
            }
            var gs = p.tg.slice(0, 4), all = [], left = gs.length;
            gs.forEach(function (g) { A.tmdb.genre(g, function (r) { all.push(r); if (--left <= 0) finish(); }); });
            function finish() {
                var merged = U.interleave(all), scored = [];
                for (var i = 0; i < merged.length; i++) scored.push({ it: merged[i], sc: Rec.score(merged[i]) });
                scored.sort(function (x, y) { return y.sc - x.sc; });
                var out = []; for (var j = 0; j < scored.length && out.length < 24; j++) if (scored[j].sc >= 0.1) out.push(scored[j].it);
                cb(U.dedup(out));
            }
        }
    };

    /* ============================================================
       ИСТОЧНИК (наследуется от tmdb → params/search/card уже есть)
    ============================================================ */
    function MultiSource(parent) {
        this.network = new Lampa.Reguest();
        this.discovery = false;

        // ---- ряд-обёртка для partNext: функция(callback) ----
        function row(title, fetchFn, view) {
            return function (cb) {
                fetchFn(function (items) {
                    var cards = (items || []).slice(0, 30);
                    for (var i = 0; i < cards.length; i++) {
                        var lbl = cfg().adapters[cards[i].source] ? cfg().adapters[cards[i].source].label : '';
                        U.decorate(cards[i], lbl);
                    }
                    cb({ results: cards, title: title, params: { items: { view: view || 3 } } });
                });
            };
        }

        // ---- ГЛАВНАЯ через partNext (штатные карточки Лампы) ----
        this.main = function (params, onComplete, onError) {
            var mode = U.mode(), c = cfg(), data = [];

            // 1) Интересно лично вам
            data.push(row(Lampa.Lang.translate('mpx_for_you'), function (cb) { Rec.get(cb); }));
            // 2) В тренде (Trakt + TMDB)
            data.push(row(Lampa.Lang.translate('mpx_trending'), function (cb) {
                var list = []; if (isOn('trakt')) list.push('trakt'); if (isOn('tmdb')) list.push('tmdb');
                U.runAll(list, function (n, d) { if (n === 'trakt') A.trakt.trending(d); else A.tmdb.trending(d); }, function (r) { cb(U.dedup(r)); });
            }));
            // 3) Популярное (умный выбор + мердж)
            data.push(row(Lampa.Lang.translate('mpx_popular'), function (cb) {
                var list = []; if (isOn('tmdb')) list.push('tmdb'); if (isOn('kp')) list.push('kp');
                U.runAll(list, function (n, d) { if (n === 'kp') A.kp.top(d); else A.tmdb.popular(d); }, function (r) { cb(U.dedup(r)); });
            }));
            // 4) Топ по рейтингу
            data.push(row(Lampa.Lang.translate('mpx_top'), function (cb) {
                var list = []; if (isOn('tmdb')) list.push('tmdb'); if (isOn('kp')) list.push('kp');
                U.runAll(list, function (n, d) { if (n === 'kp') A.kp.top250(d); else A.tmdb.top(d); }, function (r) { cb(U.dedup(r)); });
            }));
            // 5) Кассовые сборы
            if (isOn('tmdb')) data.push(row(Lampa.Lang.translate('mpx_box'), function (cb) { A.tmdb.revenue(cb); }));
            // 6) Новинки
            if (isOn('tmdb')) data.push(row(Lampa.Lang.translate('mpx_new'), function (cb) { A.tmdb.now(cb); }));

            // 7) По жанрам (топ-N жанров пользователя)
            (c.top_genres || []).forEach(function (gid) {
                var names = { 28: 'Боевик', 35: 'Комедия', 18: 'Драма', 878: 'Фантастика', 27: 'Ужасы', 53: 'Триллер', 12: 'Приключения', 16: 'Мультфильм', 80: 'Криминал', 10749: 'Мелодрама' };
                data.push(row((names[gid] || ('Жанр ' + gid)), function (cb) { A.tmdb.genre(gid, cb); }));
            });

            // 8) Глобальные стриминги (отдельный ряд на сервис) — как просил оставить
            var so = c.streams_on_main, streams = [];
            if (so === 'all' || so === 'ru') streams = streams.concat(c.streams.ru);
            if (so === 'all' || so === 'foreign') streams = streams.concat(c.streams.foreign);
            if (so !== 'off' && isOn('tmdb')) {
                streams.forEach(function (s) {
                    data.push(row('📺 ' + s.title, function (cb) { A.tmdb.stream(s.pid, s.region, cb); }));
                });
            }

            // режим rus/kids: для kids убираем «кассовые сборы» (уже не добавили если kids? оставим фильтр)
            if (mode === 'kids') data = data.filter(function (r) { return true; }); // заглушка под будущие фильтры

            function loadPart(loaded, empty) { Lampa.Api.partNext(data, 9, loaded, empty); }
            loadPart(onComplete, onError);
            return loadPart;
        };

        // ---- ОБЪЕДИНЁННЫЙ ПОИСК (переопределяем search, params наследуется от tmdb!) ----
        this.search = function (params, onComplete, onError) {
            var query = params && (params.query || params.search || '');
            if (!query || String(query).length < 2) { if (onComplete) onComplete({ results: [], title: '' }); return; }

            // сначала штатный tmdb-поиск родителя (даёт правильный формат + params)
            parent.search.call(parent, params, function (tmdbData) {
                var containerIsArray = Array.isArray(tmdbData);
                var tmdbResults = containerIsArray ? tmdbData : (tmdbData && tmdbData.results ? tmdbData.results : []);
                var title = containerIsArray ? '' : (tmdbData && tmdbData.title ? tmdbData.title : '');

                var extra = [], left = 0;
                var jobs = [];
                if (isOn('kp')) jobs.push(function (d) { A.kp.search(query, d); });
                if (isOn('omdb')) jobs.push(function (d) { A.omdb.search(query, d); });
                left = jobs.length;

                function merge() {
                    var all = tmdbResults.concat(U.interleave(extra));
                    all = U.dedup(all);
                    all.sort(function (x, y) { return ((y.popularity || 0) + (y.vote_average || 0) * 10) - ((x.popularity || 0) + (x.vote_average || 0) * 10); });
                    for (var i = 0; i < all.length; i++) { var lbl = cfg().adapters[all[i].source] ? cfg().adapters[all[i].source].label : ''; U.decorate(all[i], lbl); }
                    U.log('search "' + query + '":', all.length, 'из', (jobs.length + 1), 'источников');
                    if (onComplete) onComplete(containerIsArray ? all : { results: all, title: title });
                }
                if (!left) { merge(); return; }
                jobs.forEach(function (j) { j(function (r) { extra.push(r || []); if (--left <= 0) merge(); }); });
            }, function () {
                // если родитель упал — всё равно ищем по доп. источникам
                var extra = [], left = 0, jobs = [];
                if (isOn('kp')) jobs.push(function (d) { A.kp.search(query, d); });
                if (isOn('omdb')) jobs.push(function (d) { A.omdb.search(query, d); });
                left = jobs.length;
                if (!left) { if (onComplete) onComplete({ results: [], title: '' }); return; }
                jobs.forEach(function (j) { j(function (r) { extra.push(r || []); if (--left <= 0) { var all = U.dedup(U.interleave(extra)); if (onComplete) onComplete({ results: all, title: '' }); } }); });
            });
        };
    }

    /* ============================================================
       РЕГИСТРАЦИЯ ИСТОЧНИКА (копия tmdb → поиск не ломается)
    ============================================================ */
    function registerSource() {
        try {
            var base = Lampa.Api.sources.tmdb;
            var inst = assign({}, base, new MultiSource(base));
            Lampa.Api.sources[NAME] = inst;
            try { Object.defineProperty(Lampa.Api.sources, NAME, { get: function () { return inst; }, configurable: true }); } catch (e) {}
            U.log('источник зарегистрирован:', NAME);
        } catch (e) { U.log('registerSource err', e); }
    }

    /* ============================================================
       НАСТРОЙКИ (Lampa.SettingsApi — реальный API, как в surs)
    ============================================================ */
    function addSettings() {
        if (!Lampa.SettingsApi) { U.log('SettingsApi недоступен'); return; }
        try {
            Lampa.SettingsApi.addComponent({ component: 'multiplex', name: 'MULTIPLEX', icon: '' });

            Lampa.SettingsApi.addParam({ component: 'multiplex', param: { name: 'mpx_t_title', type: 'title' }, field: { name: 'Источник главной', description: 'Выбор и поведение источника MULTIPLEX' } });

            Lampa.SettingsApi.addParam({
                component: 'multiplex',
                param: { name: 'mpx_set_source', type: 'select', values: (function () { var v = {}; v[NAME] = 'MULTIPLEX'; v.tmdb = 'TMDB (стандарт)'; try { if (Lampa.Api.sources.cub) v.cub = 'CUB'; } catch (e) {} return v; })(), default: NAME },
                field: { name: 'Активный источник', description: 'Поставить MULTIPLEX источником главной страницы' },
                onChange: function (v) { try { Lampa.Storage.set('source', v); Lampa.Noty.show('Источник: ' + v); } catch (e) {} }
            });

            Lampa.SettingsApi.addParam({
                component: 'multiplex',
                param: { name: 'mpx_mode', type: 'select', values: { auto: 'Авто (по профилю)', main: 'Основной', rus: 'Россия', kids: 'Детский' }, default: cfg().mode },
                field: { name: 'Режим главной', description: 'Авто переключается по профилю (forKids/onlyRus)' },
                onChange: function (v) { var c = cfg(); c.mode = v; saveCfg(c); }
            });

            Lampa.SettingsApi.addParam({ component: 'multiplex', param: { name: 'mpx_a_title', type: 'title' }, field: { name: 'Источники данных (вкл/выкл)', description: 'Какие API использовать в поиске и на главной' } });

            var c0 = cfg();
            Object.keys(c0.adapters).forEach(function (n) {
                var a = c0.adapters[n];
                Lampa.SettingsApi.addParam({
                    component: 'multiplex',
                    param: { name: 'mpx_ad_' + n, type: 'select', values: { on: 'Включён', off: 'Выключен' }, default: a.enabled },
                    field: { name: a.label, description: 'Приоритет ' + a.priority + ' · RU ' + a.w_ru + ' / мир ' + a.w_for },
                    onChange: function (v) { var c = cfg(); c.adapters[n].enabled = v; saveCfg(c); }
                });
            });

            Lampa.SettingsApi.addParam({ component: 'multiplex', param: { name: 'mpx_k_title', type: 'title' }, field: { name: 'API-ключи', description: 'TMDB/KinoPoisk/OMDb — бесплатно на сайтах сервисов' } });
            [['tmdb', 'TMDB API key'], ['kp', 'KinoPoisk API key'], ['omdb', 'OMDb API key']].forEach(function (pair) {
                Lampa.SettingsApi.addParam({
                    component: 'multiplex',
                    param: { name: 'mpx_key_' + pair[0], type: 'select', values: (function () { var cur = Lampa.Storage.get('mpx_' + pair[0] + '_key', '') || cfg().adapters[pair[0]].key || ''; var v = { '': '— не задан —' }; if (cur) v[cur] = cur.slice(0, 6) + '…(задан)'; v['__edit__'] = 'Ввести новый…'; return v; })(), default: (Lampa.Storage.get('mpx_' + pair[0] + '_key', '') || cfg().adapters[pair[0]].key || '') },
                    field: { name: pair[1], description: 'Выберите «Ввести новый» и введите ключ' },
                    onChange: function (v) {
                        if (v === '__edit__') {
                            Lampa.Input.edit({ value: Lampa.Storage.get('mpx_' + pair[0] + '_key', '') || '', title: pair[1] }, function (val) {
                                Lampa.Storage.set('mpx_' + pair[0] + '_key', val || ''); var c = cfg(); c.adapters[pair[0]].key = val || ''; saveCfg(c); Lampa.Noty.show(pair[1] + ' сохранён');
                            });
                        }
                    }
                });
            });

            Lampa.SettingsApi.addParam({ component: 'multiplex', param: { name: 'mpx_d_title', type: 'title' }, field: { name: 'Оформление и поиск', description: 'Скругление карточек, анти-дубль, стриминги' } });

            Lampa.SettingsApi.addParam({
                component: 'multiplex',
                param: { name: 'mpx_radius', type: 'select', values: { 0: '0 px', 4: '4 px', 8: '8 px', 12: '12 px', 16: '16 px', 20: '20 px' }, default: String(cfg().radius) },
                field: { name: 'Скругление карточек', description: 'Стиль постеров (как в CUB)' },
                onChange: function (v) { var c = cfg(); c.radius = parseInt(v, 10) || 0; saveCfg(c); applyRadius(); }
            });

            Lampa.SettingsApi.addParam({
                component: 'multiplex',
                param: { name: 'mpx_antidup', type: 'select', values: { on: 'Включён', off: 'Выключен' }, default: cfg().anti_dup },
                field: { name: 'Анти-дубль постеров', description: 'Убирает одинаковые обложки из разных источников' },
                onChange: function (v) { var c = cfg(); c.anti_dup = v; saveCfg(c); }
            });

            Lampa.SettingsApi.addParam({
                component: 'multiplex',
                param: { name: 'mpx_streams', type: 'select', values: { all: 'Все (RU + мир)', ru: 'Только RU', foreign: 'Только мир', off: 'Скрыть' }, default: cfg().streams_on_main },
                field: { name: 'Стриминги на главной', description: 'RU: Кинопоиск/IVI/Okko/START · мир: AppleTV/Disney/Netflix' },
                onChange: function (v) { var c = cfg(); c.streams_on_main = v; saveCfg(c); }
            });

            Lampa.SettingsApi.addParam({
                component: 'multiplex',
                param: { name: 'mpx_reset', type: 'button' },
                field: { name: 'Сбросить историю рекомендаций', description: 'Очистить «Интересно лично вам»' },
                onChange: function () { Lampa.Storage.set('mpx_history', []); Lampa.Storage.set('mpx_prefs', null); try { Lampa.Noty.show('История сброшена'); } catch (e) {} }
            });

            U.log('настройки MULTIPLEX добавлены');
        } catch (e) { U.log('addSettings err', e); }
    }

    /* ============================================================
       СВОЁ МЕНЮ: ряд кнопок на главной (ContentRows, как surs_nav_buttons)
    ============================================================ */
    function addButtonsRow() {
        if (!Lampa.ContentRows) return;
        function btn(id, title, action) {
            return {
                source: 'mpx', title: title, name: title, id: id,
                params: {
                    createInstance: function () {
                        var card = Lampa.Maker.make('Card', this, function (m) { return m.only('Card', 'Callback'); });
                        return card;
                    },
                    emit: {
                        onCreate: function () {
                            try {
                                this.html.addClass('card--button-compact');
                                var lab = document.createElement('div'); lab.className = 'card__button-label'; lab.innerText = title;
                                this.html.find('.card__view').append(lab);
                            } catch (e) {}
                        },
                        onlyEnter: function () { try { action(); } catch (e) {} }
                    }
                }
            };
        }
        try {
            Lampa.ContentRows.add({
                index: 0, name: 'mpx_buttons', title: '', screen: ['main'],
                call: function () {
                    var buttons = [
                        btn('mpx_home', Lampa.Lang.translate('mpx_btn_home'), function () { Lampa.Activity.push({ source: NAME, title: 'MULTIPLEX', component: 'main', page: 1 }); }),
                        btn('mpx_search', Lampa.Lang.translate('mpx_btn_search'), function () { openSearch(); }),
                        btn('mpx_rus', Lampa.Lang.translate('mpx_btn_rus'), function () { var c = cfg(); c.mode = 'rus'; saveCfg(c); Lampa.Activity.push({ source: NAME, title: 'MULTIPLEX RUS', component: 'main', page: 1 }); }),
                        btn('mpx_kids', Lampa.Lang.translate('mpx_btn_kids'), function () { var c = cfg(); c.mode = 'kids'; saveCfg(c); Lampa.Activity.push({ source: NAME, title: 'MULTIPLEX KIDS', component: 'main', page: 1 }); }),
                        btn('mpx_set', Lampa.Lang.translate('mpx_btn_set'), function () { try { Lampa.Controller.toggle('settings'); } catch (e) {} })
                    ];
                    return function (cb) { cb({ results: buttons, title: '', params: { items: { view: 20, mapping: 'line' } } }); };
                }
            });
            U.log('ряд кнопок добавлен');
        } catch (e) { U.log('addButtonsRow err', e); }
    }

    function openSearch() {
        try { Lampa.Activity.push({ component: 'search', title: Lampa.Lang.translate('mpx_btn_search'), page: 1 }); return; } catch (e) {}
        try { Lampa.Controller.toggle('search'); } catch (e) {}
    }

    // кнопки в боковое меню (jQuery, как в surs)
    function addMenuButtons() {
        try {
            if (typeof $ === 'undefined') return;
            $('.menu__item[data-action="mpx-source"]').remove();
            function add(title, action) {
                var b = $('<li class="menu__item" data-action="mpx-source"><div class="menu__text">' + title + '</div></li>');
                b.on('hover:enter', action);
                $('.menu .menu__list').eq(0).append(b);
            }
            add('MULTIPLEX', function () { Lampa.Activity.push({ source: NAME, title: 'MULTIPLEX', component: 'main', page: 1 }); });
        } catch (e) { U.log('addMenuButtons err', e); }
    }

    /* ============================================================
       СТИЛИ (скругление через CSS-переменную + CUB-бейдж)
    ============================================================ */
    function applyRadius() {
        try { document.documentElement.style.setProperty('--mpx-radius', (cfg().radius || 0) + 'px'); } catch (e) {}
    }
    function addStyles() {
        var css = '' +
            '.card__img,.card__view{border-radius:var(--mpx-radius,8px);}' +
            '.card--button-compact .card__view{display:flex;align-items:center;justify-content:center;min-height:90px;background:#222;}' +
            '.card__button-label{position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:.8em;color:#fff;text-shadow:0 1px 2px #000;}' +
            '.mpx-q{position:absolute;top:6px;right:6px;padding:2px 6px;font-size:.7em;font-weight:700;border-radius:4px;background:rgba(0,0,0,.8);color:#fff;text-transform:uppercase;z-index:3;}' +
            '.mpx-q--4k{background:#e50914;}.mpx-q--bluray,.mpx-q--hd{background:#00a651;}.mpx-q--webdl,.mpx-q--web-dl{background:#0088cc;}.mpx-q--cam,.mpx-q--ts{background:#666;}' +
            '.mpx-src{position:absolute;bottom:6px;left:6px;padding:2px 6px;font-size:.65em;background:rgba(0,0,0,.8);color:#ffd700;border-radius:3px;font-weight:600;z-index:3;}';
        try { Lampa.Template.add('mpx_style', '<style>' + css + '</style>'); $('body').append(Lampa.Template.get('mpx_style', {}, true)); } catch (e) {
            var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
        }
        applyRadius();
    }

    /* ============================================================
       СЛУШАТЕЛИ: история просмотров + смена профиля
    ============================================================ */
    function addListeners() {
        try {
            Lampa.Listener.follow('full', function (e) {
                if (e.type === 'start' && e.object) {
                    var o = e.object;
                    Rec.add({
                        tmdb_id: o.id || o.tmdb_id, kp_id: o.kp_id, title: o.title || o.name,
                        genre_ids: o.genres ? o.genres.map(function (g) { return g.id; }) : (o.genre_ids || []),
                        actors: o.actors ? o.actors.slice(0, 10).map(function (a) { return a.name || a; }) : [],
                        directors: o.directors ? o.directors.map(function (d) { return d.name || d; }) : [],
                        tags: o.keywords ? o.keywords.map(function (k) { return k.name; }) : [],
                        runtime: o.runtime || 0, vote_average: o.vote_average || 0,
                        year: String(o.release_date || '').slice(0, 4), country: o.country || '',
                        media_type: o.number_of_seasons ? 'tv' : 'movie'
                    });
                }
            });
        } catch (e) {}
        try {
            Lampa.Listener.follow('profile', function (e) {
                if (e.type === 'changed') { U.log('профиль сменён → режим', U.mode()); addMenuButtons(); }
            });
        } catch (e) {}
    }

    /* ============================================================
       LANG
    ============================================================ */
    function addLang() {
        Lampa.Lang.add({
            mpx_for_you: { ru: '🎯 Интересно лично вам', uk: '🎯 Цікаво особисто вам', en: '🎯 For you' },
            mpx_trending: { ru: '🔥 В тренде', uk: '🔥 У тренді', en: '🔥 Trending' },
            mpx_popular: { ru: '⭐ Популярное', uk: '⭐ Популярне', en: '⭐ Popular' },
            mpx_top: { ru: '🏆 Топ по рейтингу', uk: '🏆 Топ за рейтингом', en: '🏆 Top rated' },
            mpx_box: { ru: '💰 Кассовые сборы', uk: '💰 Касові збори', en: '💰 Box office' },
            mpx_new: { ru: '🆕 Новинки', uk: '🆕 Новинки', en: '🆕 New' },
            mpx_btn_home: { ru: 'Главная', uk: 'Головна', en: 'Home' },
            mpx_btn_search: { ru: '🔍 Поиск', uk: '🔍 Пошук', en: '🔍 Search' },
            mpx_btn_rus: { ru: 'Россия', uk: 'Росія', en: 'Russia' },
            mpx_btn_kids: { ru: 'Детям', uk: 'Дітям', en: 'Kids' },
            mpx_btn_set: { ru: '⚙ Настройки', uk: '⚙ Налаштування', en: '⚙ Settings' }
        });
    }

    /* ============================================================
       СТАРТ
    ============================================================ */
    function start() {
        U.log('старт MULTIPLEX v3, режим', U.mode());
        addLang();
        registerSource();
        addSettings();
        addButtonsRow();
        addStyles();
        addMenuButtons();
        addListeners();
    }

    if (Lampa.Manifest && Lampa.Manifest.app_digital >= 300) {
        if (window.appready) start();
        else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
    } else if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });

    window.MULTIPLEX = { refresh: function () { try { Lampa.Activity.push({ source: NAME, title: 'MULTIPLEX', component: 'main', page: 1 }); } catch (e) {} }, cfg: cfg };
})();
