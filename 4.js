/* ============================================================
   MULTIPLEX v7 — главная + мульти-поиск
   Исправлено: краш настроек (правильная сигнатура addParam),
   регистрация источника (по образцу surs.js), блок поддержки.
   ============================================================ */
(function () {
    'use strict';

    function assign(target) {
        for (var i = 1; i < arguments.length; i++) {
            var s = arguments[i];
            if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) target[k] = s[k];
        }
        return target;
    }

    var NAME = 'multiplex';
    var TITLE = 'MULTIPLEX';
    var COMP = 'multiplex';

    /* ---------- конфиг ---------- */
    var DEFAULTS = {
        mode: 'auto', radius: 8, streams_on_main: 'all', anti_dup: 'on', auto_profile: 'on',
        adapters: {
            tmdb:  { enabled: 'on', label: 'TMDB',        key: '', priority: 100, w_ru: 60,  w_for: 100 },
            kp:    { enabled: 'on', label: 'Кинопоиск',   key: '', priority: 90,  w_ru: 100, w_for: 50  },
            omdb:  { enabled: 'on', label: 'OMDb / IMDb', key: '', priority: 70,  w_ru: 30,  w_for: 75  },
            trakt: { enabled: 'on', label: 'Trakt',       key: '7a4f4a40096c3491ec8be46d9f00c4f8b3ce43b1c0c86f42f30dc5f1839a1670', priority: 80, w_ru: 40, w_for: 90 },
            fanart:{ enabled: 'on', label: 'Fanart.tv',   key: '', priority: 50,  w_ru: 80,  w_for: 90  }
        },
        weights: { genre: 0.35, tag: 0.20, actor: 0.15, director: 0.15, runtime: 0.05, rating: 0.05, year: 0.03, country: 0.02 },
        streams: {
            ru:      [ { id: 'kp', title: 'Кинопоиск', pid: 115, region: 'RU' }, { id: 'ivi', title: 'IVI', pid: 113, region: 'RU' }, { id: 'okko', title: 'Okko', pid: 116, region: 'RU' }, { id: 'start', title: 'START', pid: 118, region: 'RU' } ],
            foreign: [ { id: 'appletv', title: 'Apple TV+', pid: 350, region: 'US' }, { id: 'disney', title: 'Disney+', pid: 337, region: 'US' }, { id: 'netflix', title: 'Netflix', pid: 8, region: 'US' } ]
        },
        top_genres: [28, 35, 18, 878, 27, 53]
    };

    function cfg() {
        var c = Lampa.Storage.get('mpx_cfg', null);
        if (!c) { Lampa.Storage.set('mpx_cfg', DEFAULTS); return DEFAULTS; }
        return assign({}, DEFAULTS, c, { adapters: assign({}, DEFAULTS.adapters, c.adapters || {}), weights: assign({}, DEFAULTS.weights, c.weights || {}), streams: assign({}, DEFAULTS.streams, c.streams || {}) });
    }
    function saveCfg(c) { Lampa.Storage.set('mpx_cfg', c); }
    function isOn(a) { var x = cfg().adapters[a]; return x && x.enabled === 'on'; }

    /* ---------- лог ---------- */
    var LOG = {
        on: true, hist: [],
        add: function (lv, m, d) {
            this.hist.push({ ts: new Date().toISOString(), lv: lv, m: m, d: d });
            if (this.hist.length > 200) this.hist.shift();
            if (!this.on) return;
            var p = '[MULTIPLEX]';
            if (lv === 'error') console.error(p, m, d || '');
            else if (lv === 'warn') console.warn(p, m, d || '');
            else console.log(p, m, d || '');
        },
        info: function (m, d) { this.add('info', m, d); },
        warn: function (m, d) { this.add('warn', m, d); },
        error: function (m, d) { this.add('error', m, d); },
        dump: function (n) { return this.hist.slice(-(n || 30)).map(function (l) { return '[' + l.ts.slice(11, 19) + '] ' + l.lv.toUpperCase() + ' ' + l.m; }).join('\n'); }
    };

    /* ---------- утилиты ---------- */
    var U = {
        req: function (url, headers, ok, err, timeout) {
            try {
                var r = new Lampa.Reguest();
                var o = headers ? { headers: headers } : {};
                if (timeout) o.timeout = timeout;
                r.native(url, function (d) { if (ok) ok(d); }, function (x, y) { LOG.error('req fail ' + url, { x: x, y: y }); if (err) err(x, y); }, o);
                return r;
            } catch (e) { LOG.error('req throw ' + url, e); if (err) err(e); }
        },
        mode: function () {
            var m = cfg().mode;
            if (m && m !== 'auto') return m;
            try {
                var p = Lampa.Storage.get('profile', null);
                if (p && p.params) { if (p.params.forKids) return 'kids'; if (p.params.onlyRus) return 'rus'; }
            } catch (e) {}
            return 'main';
        },
        interleave: function (arrs) {
            var out = [], mx = 0, i, p, s;
            for (i = 0; i < arrs.length; i++) if (arrs[i] && arrs[i].length > mx) mx = arrs[i].length;
            for (p = 0; p < mx; p++) for (s = 0; s < arrs.length; s++) if (arrs[s] && arrs[s][p]) out.push(arrs[s][p]);
            return out;
        },
        dedup: function (items) {
            var seen = {}, post = {}, out = [], anti = cfg().anti_dup === 'on', i, it, key, ph;
            for (i = 0; i < items.length; i++) {
                it = items[i];
                key = it.imdb_id || (it.tmdb_id ? 't' + it.tmdb_id : '') || (it.id ? 'i' + it.id : '') || ((it.title || it.name || '') + '_' + (it.year || ''));
                if (seen[key]) continue;
                if (anti && it.poster_path) {
                    ph = String(it.poster_path).replace(/\/w\d+\//, '/').replace(/\/original\//, '/');
                    if (post[ph]) continue; post[ph] = 1;
                }
                seen[key] = 1; out.push(it);
            }
            return out;
        },
        runAll: function (list, fn, done) {
            var res = [], left = list.length;
            if (!left) { done([]); return; }
            list.forEach(function (n, idx) { fn(n, function (r) { res[idx] = r || []; if (--left <= 0) done(U.interleave(res)); }); });
        },
        chain: function (task) {
            var c = cfg(), arr = [], n, a, sc, st;
            for (n in c.adapters) {
                a = c.adapters[n]; if (a.enabled !== 'on') continue;
                sc = a.priority + (task === 'ru' ? a.w_ru : a.w_for);
                st = STATS[n]; if (st && st.ok + st.fail > 0) sc *= (st.ok / (st.ok + st.fail));
                arr.push({ n: n, sc: sc });
            }
            arr.sort(function (x, y) { return y.sc - x.sc; });
            return arr.map(function (o) { return o.n; });
        },
        decorate: function (card, label) {
            card.params = card.params || {};
            card.params.emit = assign({}, card.params.emit || {}, {
                onCreate: function () {
                    try {
                        var v = this.html.find('.card__view');
                        if (label && !v.find('.mpx-src').length) v.append('<div class="mpx-src">' + label + '</div>');
                    } catch (e) {}
                }
            });
            return card;
        }
    };

    var STATS = {};
    function stat(n, ok) { if (!STATS[n]) STATS[n] = { ok: 0, fail: 0 }; if (ok) STATS[n].ok++; else STATS[n].fail++; }

    /* ---------- проверка источников ---------- */
    var Checker = {
        check: function (n, cb) {
            LOG.info('check ' + n);
            var key;
            if (n === 'tmdb') {
                key = cfg().adapters.tmdb.key || Lampa.Storage.get('mpx_tmdb_key', '');
                if (!key) { cb({ ok: false, msg: 'ключ не задан' }); return; }
                U.req('https://api.themoviedb.org/3/movie/popular?api_key=' + key + '&language=ru-RU&page=1', null,
                    function (d) { cb({ ok: true, msg: 'OK', count: d && d.results ? d.results.length : 0 }); },
                    function () { cb({ ok: false, msg: 'нет ответа / неверный ключ' }); }, 6000);
            } else if (n === 'kp') {
                key = cfg().adapters.kp.key || Lampa.Storage.get('mpx_kp_key', '');
                if (!key) { cb({ ok: false, msg: 'ключ не задан' }); return; }
                U.req('https://kinopoiskapiunofficial.tech/api/v2.2/films/top?type=TOP_100_POPULAR_FILMS&page=1', { 'X-API-KEY': key },
                    function (d) { cb({ ok: true, msg: 'OK', count: d && d.films ? d.films.length : 0 }); },
                    function () { cb({ ok: false, msg: 'нет ответа / неверный ключ' }); }, 6000);
            } else if (n === 'omdb') {
                key = cfg().adapters.omdb.key || Lampa.Storage.get('mpx_omdb_key', '');
                if (!key) { cb({ ok: false, msg: 'ключ не задан' }); return; }
                U.req('https://www.omdbapi.com/?s=spiderman&apikey=' + key, null,
                    function (d) { cb({ ok: true, msg: 'OK', count: d && d.Search ? d.Search.length : 0 }); },
                    function () { cb({ ok: false, msg: 'нет ответа / неверный ключ' }); }, 6000);
            } else if (n === 'trakt') {
                U.req('https://api.trakt.tv/movies/trending?limit=1', { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': cfg().adapters.trakt.key },
                    function (d) { cb({ ok: true, msg: 'OK', count: d ? d.length : 0 }); },
                    function () { cb({ ok: false, msg: 'нет ответа' }); }, 6000);
            } else cb({ ok: false, msg: 'неизвестный источник' });
        }
    };

    /* ---------- адаптеры ---------- */
    var A = {
        tmdb: {
            key: function () { return cfg().adapters.tmdb.key || Lampa.Storage.get('mpx_tmdb_key', ''); },
            url: function (p, ex) { return 'https://api.themoviedb.org/3' + p + '?api_key=' + this.key() + '&language=ru-RU' + (ex || ''); },
            map: function (arr) {
                return (arr || []).map(function (it) {
                    return {
                        source: 'tmdb', id: it.id, tmdb_id: it.id, imdb_id: it.imdb_id || '',
                        title: it.title || it.name || '', name: it.name || it.title || '',
                        original_title: it.original_title || it.original_name || '', overview: it.overview || '',
                        media_type: it.media_type || (it.first_air_date ? 'tv' : 'movie'),
                        poster_path: it.poster_path || '', backdrop_path: it.backdrop_path || '',
                        vote_average: it.vote_average || 0, popularity: it.popularity || 0,
                        release_date: it.release_date || it.first_air_date || '', year: String((it.release_date || it.first_air_date || '').slice(0, 4)),
                        genre_ids: it.genre_ids || []
                    };
                });
            },
            get: function (p, ex, cb) { var self = this; U.req(this.url(p, ex), null, function (d) { stat('tmdb', true); cb(self.map(d.results || d.items || [])); }, function () { stat('tmdb', false); cb([]); }); },
            trending: function (cb) { this.get('/trending/all/week', '', cb); },
            popular: function (cb) { var self = this; U.runAll(['movie', 'tv'], function (t, d) { self.get('/' + t + '/popular', '', d); }, function (r) { cb(U.dedup(U.interleave(r))); }); },
            top: function (cb) { this.get('/movie/top_rated', '', cb); },
            revenue: function (cb) { this.get('/discover/movie', '&sort_by=revenue.desc&primary_release_date.lte=' + new Date().toISOString().slice(0, 10), cb); },
            now: function (cb) { this.get('/movie/now_playing', '', cb); },
            genre: function (g, cb) { this.get('/discover/movie', '&with_genres=' + g + '&sort_by=popularity.desc', cb); },
            stream: function (pid, reg, cb) { this.get('/discover/movie', '&with_watch_providers=' + pid + '&watch_region=' + (reg || 'RU') + '&sort_by=popularity.desc', cb); }
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
                        year: String(it.Year || '').slice(0, 4), media_type: it.Type === 'series' ? 'tv' : 'movie', vote_average: 0, genre_ids: []
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
            trending: function (cb) { var self = this; U.req('https://api.trakt.tv/movies/trending?limit=30', this.h(), function (d) { stat('trakt', true); cb(self.map(d || [])); }, function () { stat('trakt', false); cb([]); }); }
        }
    };

    /* ---------- рекомендации ---------- */
    var Rec = {
        HK: 'mpx_history', PK: 'mpx_prefs',
        add: function (o) {
            var h = Lampa.Storage.get(this.HK, []) || [];
            h.unshift(o); if (h.length > 300) h = h.slice(0, 300);
            Lampa.Storage.set(this.HK, h); this.rebuild();
        },
        rebuild: function () {
            var h = Lampa.Storage.get(this.HK, []) || []; if (!h.length) return;
            var p = { genres: {}, tags: {}, actors: {}, directors: {}, rt: [], rat: [], yr: [], countries: {} }, i, x, w;
            for (i = 0; i < h.length; i++) {
                x = h[i]; w = 1 - (i / h.length) * 0.5;
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
            var top = function (o, n) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, n); };
            p.avg_rt = Math.round(avg(p.rt)); p.avg_rat = avg(p.rat); p.avg_yr = Math.round(avg(p.yr));
            p.tg = top(p.genres, 8); p.tt = top(p.tags, 10); p.ta = top(p.actors, 15); p.td = top(p.directors, 10); p.tc = top(p.countries, 5);
            Lampa.Storage.set(this.PK, p);
        },
        score: function (c) {
            var p = Lampa.Storage.get(this.PK, null); if (!p) return 0; var W = cfg().weights, s = 0, i, mg, mt, ma, md;
            if (c.genre_ids && p.tg && p.tg.length) { mg = 0; for (i = 0; i < c.genre_ids.length; i++) if (p.tg.indexOf(String(c.genre_ids[i])) !== -1) mg++; s += W.genre * (mg / Math.max(c.genre_ids.length, 1)); }
            if (c.tags && p.tt && p.tt.length) { mt = 0; for (i = 0; i < c.tags.length; i++) if (p.tt.indexOf(c.tags[i]) !== -1) mt++; s += W.tag * Math.min(mt / 3, 1); }
            if (c.actors && p.ta && p.ta.length) { ma = 0; for (i = 0; i < c.actors.length; i++) if (p.ta.indexOf(c.actors[i]) !== -1) ma++; s += W.actor * Math.min(ma / 3, 1); }
            if (c.directors && p.td && p.td.length) { md = 0; for (i = 0; i < c.directors.length; i++) if (p.td.indexOf(c.directors[i]) !== -1) md++; s += W.director * Math.min(md / 2, 1); }
            if (c.runtime && p.avg_rt) s += W.runtime * Math.max(0, 1 - Math.abs(c.runtime - p.avg_rt) / 60);
            if (c.vote_average && p.avg_rat) s += W.rating * Math.max(0, 1 - Math.abs(c.vote_average - p.avg_rat) / 3);
            if (c.year && p.avg_yr) s += W.year * Math.max(0, 1 - Math.abs(parseInt(c.year, 10) - p.avg_yr) / 20);
            if (c.country && p.tc && p.tc.indexOf(c.country) !== -1) s += W.country;
            return s;
        },
        get: function (cb) {
            var p = Lampa.Storage.get(this.PK, null);
            if (!p || !p.tg || !p.tg.length) { A.tmdb.popular(function (r) { cb(r.slice(0, 24)); }); return; }
            var gs = p.tg.slice(0, 4), all = [], left = gs.length;
            gs.forEach(function (g) { A.tmdb.genre(g, function (r) { all.push(r); if (--left <= 0) fin(); }); });
            function fin() {
                var m = U.interleave(all), sc = [], i, j, out = [];
                for (i = 0; i < m.length; i++) sc.push({ it: m[i], s: Rec.score(m[i]) });
                sc.sort(function (x, y) { return y.s - x.s; });
                for (j = 0; j < sc.length && out.length < 24; j++) if (sc[j].s >= 0.1) out.push(sc[j].it);
                cb(U.dedup(out));
            }
        }
    };

    /* ---------- источник ---------- */
    function MultiSource(parent) {
        this.network = new Lampa.Reguest();
        this.discovery = false;
        this.title = TITLE;
        this.name = NAME;

        function row(title, fetch, view) {
            return function (cb) {
                fetch(function (items) {
                    var cards = (items || []).slice(0, 30), i, lbl;
                    for (i = 0; i < cards.length; i++) { lbl = cfg().adapters[cards[i].source] ? cfg().adapters[cards[i].source].label : ''; U.decorate(cards[i], lbl); }
                    cb({ results: cards, title: title, params: { items: { view: view || 3 } } });
                });
            };
        }

        this.main = function (params, onComplete, onError) {
            var c = cfg(), data = [], prof, isKids, so, streams;
            try { prof = Lampa.Storage.get('profile', null); } catch (e) { prof = null; }
            isKids = !!(prof && prof.params && prof.params.forKids);

            data.push(row(Lampa.Lang.translate('mpx_for_you'), function (cb) { Rec.get(cb); }));
            data.push(row(Lampa.Lang.translate('mpx_trending'), function (cb) {
                var l = []; if (isOn('trakt')) l.push('trakt'); if (isOn('tmdb')) l.push('tmdb');
                U.runAll(l, function (n, d) { if (n === 'trakt') A.trakt.trending(d); else A.tmdb.trending(d); }, function (r) { cb(U.dedup(r)); });
            }));
            data.push(row(Lampa.Lang.translate('mpx_popular'), function (cb) {
                var l = []; if (isOn('tmdb')) l.push('tmdb'); if (isOn('kp')) l.push('kp');
                U.runAll(l, function (n, d) { if (n === 'kp') A.kp.top(d); else A.tmdb.popular(d); }, function (r) { cb(U.dedup(r)); });
            }));
            data.push(row(Lampa.Lang.translate('mpx_top'), function (cb) {
                var l = []; if (isOn('tmdb')) l.push('tmdb'); if (isOn('kp')) l.push('kp');
                U.runAll(l, function (n, d) { if (n === 'kp') A.kp.top250(d); else A.tmdb.top(d); }, function (r) { cb(U.dedup(r)); });
            }));
            if (!isKids && isOn('tmdb')) data.push(row(Lampa.Lang.translate('mpx_box'), function (cb) { A.tmdb.revenue(cb); }));
            if (!isKids && isOn('tmdb')) data.push(row(Lampa.Lang.translate('mpx_new'), function (cb) { A.tmdb.now(cb); }));

            (c.top_genres || []).forEach(function (gid) {
                var nm = { 28: 'Боевик', 35: 'Комедия', 18: 'Драма', 878: 'Фантастика', 27: 'Ужасы', 53: 'Триллер', 12: 'Приключения', 16: 'Мультфильм', 80: 'Криминал', 10749: 'Мелодрама' };
                data.push(row(nm[gid] || ('Жанр ' + gid), function (cb) { A.tmdb.genre(gid, cb); }));
            });

            so = c.streams_on_main; streams = [];
            if (so === 'all' || so === 'ru') streams = streams.concat(c.streams.ru);
            if (so === 'all' || so === 'foreign') streams = streams.concat(c.streams.foreign);
            if (so !== 'off' && isOn('tmdb')) streams.forEach(function (s) { data.push(row(s.title, function (cb) { A.tmdb.stream(s.pid, s.region, cb); })); });

            function load(loaded, empty) { Lampa.Api.partNext(data, 9, loaded, empty); }
            load(onComplete, onError);
            return load;
        };

        this.search = function (params, onComplete, onError) {
            var query = params && (params.query || params.search || '');
            if (!query || String(query).length < 2) { if (onComplete) onComplete({ results: [], title: '' }); return; }

            function jobsFor() {
                var j = [], pr = U.chain('search');
                pr.forEach(function (src) {
                    if (src === 'kp' && isOn('kp')) j.push(function (d) { A.kp.search(query, d); });
                    else if (src === 'omdb' && isOn('omdb')) j.push(function (d) { A.omdb.search(query, d); });
                });
                return j;
            }

            parent.search.call(parent, params, function (td) {
                var isArr = Array.isArray(td);
                var base = isArr ? td : (td && td.results ? td.results : []);
                var title = isArr ? '' : (td && td.title ? td.title : '');
                var extra = [], jobs = jobsFor(), left = jobs.length;
                function merge() {
                    var all = U.dedup(base.concat(U.interleave(extra)));
                    all.sort(function (x, y) { return ((y.popularity || 0) + (y.vote_average || 0) * 10) - ((x.popularity || 0) + (x.vote_average || 0) * 10); });
                    for (var i = 0; i < all.length; i++) { var l = cfg().adapters[all[i].source] ? cfg().adapters[all[i].source].label : ''; U.decorate(all[i], l); }
                    LOG.info('search "' + query + '" → ' + all.length + ' (источников ' + (jobs.length + 1) + ')');
                    if (onComplete) onComplete(isArr ? all : { results: all, title: title });
                }
                if (!left) { merge(); return; }
                jobs.forEach(function (j) { j(function (r) { extra.push(r || []); if (--left <= 0) merge(); }); });
            }, function () {
                var extra = [], jobs = jobsFor(), left = jobs.length;
                if (!left) { if (onComplete) onComplete({ results: [], title: '' }); return; }
                jobs.forEach(function (j) { j(function (r) { extra.push(r || []); if (--left <= 0) { if (onComplete) onComplete({ results: U.dedup(U.interleave(extra)), title: '' }); } }); });
            });
        };
    }

    /* ---------- регистрация источника ---------- */
    function registerSource() {
        try {
            if (!Lampa.Api || !Lampa.Api.sources || !Lampa.Api.sources.tmdb) { LOG.error('Lampa.Api.sources.tmdb недоступен'); return; }
            var base = Lampa.Api.sources.tmdb;
            var inst = assign({}, base, new MultiSource(base));
            // явно переопределяем title/name — иначе унаследуется 'TMDB'
            inst.title = TITLE;
            inst.name = NAME;
            Lampa.Api.sources[NAME] = inst;
            try { Object.defineProperty(Lampa.Api.sources, NAME, { get: function () { return inst; }, configurable: true }); } catch (e) {}
            var keys = Object.keys(Lampa.Api.sources).map(function (k) { return k + '(' + (Lampa.Api.sources[k] && Lampa.Api.sources[k].title || '?') + ')'; });
            LOG.info('источник зарегистрирован. Реестр:', keys.join(', '));
        } catch (e) { LOG.error('registerSource', e); }
    }

    /* ---------- иконка-камера ---------- */
    var CAMERA_SVG = '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">' +
        '<defs><pattern id="mpxhatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="1.6"/></pattern></defs>' +
        '<rect x="6" y="10" width="40" height="30" rx="7"/>' +
        '<circle cx="13" cy="17" r="2.6"/>' +
        '<rect x="16" y="22" width="28" height="14" fill="url(#mpxhatch)"/>' +
        '<ellipse cx="50" cy="25" rx="5" ry="11"/>' +
        '</svg>';

    function registerIcon() {
        try {
            if (Lampa.Template && Lampa.Template.add) {
                Lampa.Template.add('mpx_ico', CAMERA_SVG);
                LOG.info('иконка mpx_ico зарегистрирована');
            }
        } catch (e) { LOG.error('registerIcon', e); }
    }

    /* ---------- настройки (ИСПРАВЛЕНО: правильная сигнатура addParam) ---------- */
    var _titleIdx = 0;
    function addSettings() {
        if (!Lampa.SettingsApi) { LOG.warn('SettingsApi недоступен'); return; }
        var S = Lampa.SettingsApi;

        // Единый хелпер: правильная сигнатура SettingsApi.addParam
        // addParam(componentName, { param: {...}, field: { name, description } })
        function P(param, field) {
            try {
                S.addParam(COMP, { param: param, field: field || { name: param.name, description: '' } });
            } catch (e) {
                LOG.error('addParam ' + (param && param.name), e);
            }
        }
        function title(label, desc) {
            _titleIdx++;
            P({ name: 'mpx_title_' + _titleIdx, type: 'title' }, { name: label, description: desc || '' });
        }

        try {
            // Регистрация компонента с иконкой
            S.addComponent({ component: COMP, name: TITLE, icon: 'mpx_ico' });

            /* ====== Секция: Источник ====== */
            P({ name: 'mpx_set_source', type: 'select',
                values: (function () {
                    var v = {};
                    v[NAME] = TITLE;
                    try { if (Lampa.Api.sources.tmdb) v.tmdb = Lampa.Api.sources.tmdb.title || 'TMDB'; } catch (e) { v.tmdb = 'TMDB'; }
                    try { if (Lampa.Api.sources.cub) v.cub = Lampa.Api.sources.cub.title || 'CUB'; } catch (e) {}
                    try { if (Lampa.Api.sources.surs) v.surs = Lampa.Api.sources.surs.title || 'SURS'; } catch (e) {}
                    return v;
                })(),
                default: Lampa.Storage.get('source', NAME) || NAME
              }, { name: 'Сделать основным источником', description: 'Аналог системного выбора Настройки → Основной источник' });

            P({ name: 'mpx_mode', type: 'select',
                values: { auto: 'Авто (по профилю)', main: 'Основной', rus: 'Россия', kids: 'Детский' },
                default: cfg().mode
              }, { name: 'Режим главной', description: 'Авто — переключается по профилю forKids / onlyRus' });

            P({ name: 'mpx_auto_profile', type: 'select',
                values: { on: 'Включено', off: 'Выключено' },
                default: cfg().auto_profile
              }, { name: 'Авто-переключение по профилю', description: 'Менять источник/режим при смене профиля' });

            /* ====== Секция: Источники данных ====== */
            title('Источники данных', 'Какие API использовать в поиске и на главной');
            var ad = cfg().adapters;
            Object.keys(ad).forEach(function (n) {
                var a = ad[n];
                P({ name: 'mpx_ad_' + n, type: 'select',
                    values: { on: 'Включён', off: 'Выключен' },
                    default: a.enabled
                  }, { name: a.label, description: 'приоритет ' + a.priority + ' · RU ' + a.w_ru + ' / мир ' + a.w_for });
            });

            /* ====== Секция: Диагностика ====== */
            title('Диагностика', 'Проверка ключей и реестра источников');
            ['tmdb', 'kp', 'omdb', 'trakt'].forEach(function (n) {
                P({ name: 'mpx_check_' + n, type: 'button' },
                  { name: 'Проверить ' + cfg().adapters[n].label, description: 'Тестовый запрос к API' });
            });
            P({ name: 'mpx_list_src', type: 'button' },
              { name: 'Показать источники Lampa', description: 'Список Lampa.Api.sources (попадание в меню выбора)' });
            P({ name: 'mpx_logs', type: 'button' },
              { name: 'Показать логи', description: 'Последние записи консоли плагина' });

            /* ====== Секция: API-ключи ====== */
            title('API-ключи', 'Бесплатно на сайтах сервисов (нажмите «Ввести / изменить» и введите ключ)');
            [['tmdb', 'TMDB'], ['kp', 'Кинопоиск'], ['omdb', 'OMDb']].forEach(function (pair) {
                P({ name: 'mpx_key_' + pair[0], type: 'button' },
                  { name: pair[1] + ' — ввести / изменить ключ', description: Lampa.Storage.get('mpx_' + pair[0] + '_key', '') ? 'ключ задан' : 'ключ не задан' });
            });

            /* ====== Секция: Оформление ====== */
            title('Оформление', 'Вид карточек и рядов');
            P({ name: 'mpx_radius', type: 'select',
                values: { 0: '0 px', 4: '4 px', 8: '8 px', 12: '12 px', 16: '16 px', 20: '20 px' },
                default: String(cfg().radius)
              }, { name: 'Скругление постеров', description: 'Стиль CUB' });

            P({ name: 'mpx_antidup', type: 'select',
                values: { on: 'Включён', off: 'Выключен' },
                default: cfg().anti_dup
              }, { name: 'Анти-дубль обложек', description: 'Убирает одинаковые постеры из разных источников' });

            P({ name: 'mpx_streams', type: 'select',
                values: { all: 'Все (RU + мир)', ru: 'Только RU', foreign: 'Только мир', off: 'Скрыть' },
                default: cfg().streams_on_main
              }, { name: 'Стриминги на главной', description: 'RU: Кинопоиск/IVI/Okko/START · мир: AppleTV/Disney/Netflix' });

            /* ====== Секция: Данные ====== */
            title('Данные', '');
            P({ name: 'mpx_reset', type: 'button' },
              { name: 'Сбросить историю рекомендаций', description: 'Очистить «Под вас»' });

            /* ====== Секция: Поддержка автора ====== */
            title('💛 Поддержка автора', 'Мечтаю собрать на ПАЗик и построить из него автодом для отдыха с семьёй у реки');
            P({ name: 'mpx_donate_info', type: 'static',
                display: 'Любая сумма поможет. В комментарии укажи «это тебе на ПАЗик».\n\n**СБЕР:** +7 923 668 0000'
              }, { name: 'Реквизиты', description: 'Сбербанк, по номеру телефона' });

            bindSettings();
            LOG.info('настройки добавлены, всего ' + _titleIdx + ' секций');
        } catch (e) {
            LOG.error('addSettings', e);
        }
    }

    function bindSettings() {
        // Обработка кликов и изменений значений.
        // SettingsApi не вызывает onChange напрямую — ловим через делегирование по data-name.
        var handled = {};

        document.addEventListener('click', function (e) {
            var el = e.target && e.target.closest ? e.target.closest('[data-name]') : null;
            if (!el) return;
            var nm = el.getAttribute('data-name');
            if (!nm || nm.indexOf('mpx_') !== 0) return;
            // предотвращаем двойной клик
            if (handled[nm] && Date.now() - handled[nm] < 400) return;
            handled[nm] = Date.now();

            try {
                if (nm.indexOf('mpx_check_') === 0) {
                    var src = nm.replace('mpx_check_', '');
                    try { Lampa.Noty.show('Проверка ' + cfg().adapters[src].label + '…'); } catch (er) {}
                    Checker.check(src, function (res) {
                        var txt = cfg().adapters[src].label + ': ' + res.msg + (res.ok ? ' (' + res.count + ')' : '');
                        try { Lampa.Noty.show(txt); } catch (er) {}
                        LOG.info('check ' + src, res);
                    });
                } else if (nm === 'mpx_list_src') {
                    var keys = [];
                    try { keys = Object.keys(Lampa.Api.sources); } catch (er) {}
                    var txt = keys.map(function (k) {
                        var t = Lampa.Api.sources[k] && (Lampa.Api.sources[k].title || Lampa.Api.sources[k].name);
                        return k + (t ? '  →  ' + t : '');
                    }).join('\n');
                    try { Lampa.Input.edit({ value: txt || '(пусто)', title: 'Lampa.Api.sources' }, function () {}); } catch (er) { LOG.error('list_src', er); }
                } else if (nm === 'mpx_logs') {
                    try { Lampa.Input.edit({ value: LOG.dump(40) || '(пусто)', title: 'Логи MULTIPLEX' }, function () {}); } catch (er) {}
                } else if (nm === 'mpx_reset') {
                    Lampa.Storage.set('mpx_history', []); Lampa.Storage.set('mpx_prefs', null);
                    try { Lampa.Noty.show('История сброшена'); } catch (er) {}
                } else if (nm.indexOf('mpx_key_') === 0) {
                    var kk = nm.replace('mpx_key_', '');
                    try {
                        Lampa.Input.edit({
                            value: Lampa.Storage.get('mpx_' + kk + '_key', '') || '',
                            title: cfg().adapters[kk].label + ' — API ключ'
                        }, function (v) {
                            Lampa.Storage.set('mpx_' + kk + '_key', v || '');
                            var c = cfg(); c.adapters[kk].key = v || ''; saveCfg(c);
                            try { Lampa.Noty.show(cfg().adapters[kk].label + ': ключ сохранён'); } catch (er) {}
                            LOG.info('key ' + kk + ' saved');
                        });
                    } catch (er) { LOG.error('key edit', er); }
                }
            } catch (ex) {
                LOG.error('click handler ' + nm, ex);
            }
        }, true);

        document.addEventListener('change', function (e) {
            var el = e.target && e.target.closest ? e.target.closest('[data-name]') : null;
            if (!el) return;
            var nm = el.getAttribute('data-name'), val = el.value;
            if (!nm || nm.indexOf('mpx_') !== 0) return;
            var c = cfg();
            try {
                if (nm === 'mpx_set_source') {
                    Lampa.Storage.set('source', val);
                    try { Lampa.Noty.show('Основной источник: ' + val); } catch (er) {}
                    LOG.info('source set to ' + val);
                }
                else if (nm === 'mpx_mode') { c.mode = val; saveCfg(c); }
                else if (nm === 'mpx_auto_profile') { c.auto_profile = val; saveCfg(c); }
                else if (nm.indexOf('mpx_ad_') === 0) { c.adapters[nm.replace('mpx_ad_', '')].enabled = val; saveCfg(c); }
                else if (nm === 'mpx_radius') { c.radius = parseInt(val, 10) || 0; saveCfg(c); applyRadius(); }
                else if (nm === 'mpx_antidup') { c.anti_dup = val; saveCfg(c); }
                else if (nm === 'mpx_streams') { c.streams_on_main = val; saveCfg(c); }
            } catch (ex) {
                LOG.error('change handler ' + nm, ex);
            }
        }, true);
    }

    /* ---------- таб-бар ---------- */
    function addButtonsRow() {
        if (!Lampa.ContentRows) { LOG.warn('ContentRows недоступен'); return; }
        var ICO = {
            home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>',
            rus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.7h18M3 14.3h18"/></svg>',
            eng: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>',
            kids: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="9" r="5"/><path d="M9 8h.01M15 8h.01M9.5 11c.8.7 4.2.7 5 0"/><path d="M5 21c0-3.3 3.1-5 7-5s7 1.7 7 5"/></svg>',
            you: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20.5 4.5 13a4.6 4.6 0 0 1 6.5-6.5l1 1 1-1A4.6 4.6 0 0 1 19.5 13Z"/></svg>',
            set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>'
        };
        function btn(id, t, ico, act) {
            return {
                source: 'mpx', title: t, name: t, id: id,
                params: {
                    createInstance: function () { return Lampa.Maker.make('Card', this, function (m) { return m.only('Card', 'Callback'); }); },
                    emit: {
                        onCreate: function () {
                            try {
                                this.html.addClass('mpx-tab');
                                var v = this.html.find('.card__view');
                                v.html('<div class="mpx-tab__ico">' + (ico || '') + '</div><div class="mpx-tab__lbl">' + t + '</div>');
                            } catch (e) { LOG.error('tab onCreate', e); }
                        },
                        onlyEnter: function () { try { act(); } catch (e) { LOG.error('tab act', e); } }
                    }
                }
            };
        }
        try {
            Lampa.ContentRows.add({
                index: 0, name: 'mpx_tabs', title: '', screen: ['main'],
                call: function () {
                    var b = [
                        btn('t_home', Lampa.Lang.translate('mpx_home'), ICO.home, function () { Lampa.Activity.push({ source: NAME, title: TITLE, component: 'main', page: 1 }); }),
                        btn('t_rus', Lampa.Lang.translate('mpx_rus'), ICO.rus, function () { var c = cfg(); c.mode = 'rus'; saveCfg(c); Lampa.Activity.push({ source: NAME, title: TITLE + ' · RU', component: 'main', page: 1 }); }),
                        btn('t_eng', Lampa.Lang.translate('mpx_eng'), ICO.eng, function () { var c = cfg(); c.mode = 'main'; saveCfg(c); Lampa.Activity.push({ source: NAME, title: TITLE + ' · EN', component: 'main', page: 1 }); }),
                        btn('t_kids', Lampa.Lang.translate('mpx_kids'), ICO.kids, function () { var c = cfg(); c.mode = 'kids'; saveCfg(c); Lampa.Activity.push({ source: NAME, title: TITLE + ' · KIDS', component: 'main', page: 1 }); }),
                        btn('t_you', Lampa.Lang.translate('mpx_for_you'), ICO.you, function () { Lampa.Activity.push({ source: NAME, title: Lampa.Lang.translate('mpx_for_you'), component: 'main', page: 1 }); }),
                        btn('t_set', Lampa.Lang.translate('mpx_settings'), ICO.set, function () { try { Lampa.Controller.toggle('settings'); } catch (e) {} })
                    ];
                    return function (cb) { cb({ results: b, title: '', params: { items: { view: 20, mapping: 'line' } } }); };
                }
            });
            LOG.info('таб-бар добавлен');
        } catch (e) { LOG.error('addButtonsRow', e); }
    }

    /* ---------- стили ---------- */
    function applyRadius() { try { document.documentElement.style.setProperty('--mpx-r', (cfg().radius || 0) + 'px'); } catch (e) {} }
    function addStyles() {
        var css = '' +
            '.card__img{border-radius:var(--mpx-r,8px);}' +
            '.mpx-src{position:absolute;left:6px;bottom:6px;padding:2px 7px;font-size:.62em;font-weight:700;letter-spacing:.03em;background:rgba(0,0,0,.78);color:#ffd24a;border-radius:4px;z-index:4;backdrop-filter:blur(2px);}' +
            '.mpx-tab .card__view{background:transparent!important;border:none!important;box-shadow:none!important;aspect-ratio:auto!important;height:auto!important;min-height:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:10px 6px;border-radius:10px;transition:background .18s ease,transform .18s ease;}' +
            '.mpx-tab .card__img,.mpx-tab .card__poster,.mpx-tab .card__view img{display:none!important;}' +
            '.mpx-tab__ico{width:34px;height:34px;color:#9a9a9a;transition:color .18s ease,transform .18s ease;}' +
            '.mpx-tab__ico svg{width:100%;height:100%;display:block;}' +
            '.mpx-tab__lbl{font-size:.78em;color:#8d8d8d;text-align:center;line-height:1.15;white-space:nowrap;transition:color .18s ease;font-weight:500;}' +
            '.mpx-tab.focus .card__view,.mpx-tab.select .card__view,.mpx-tab:hover .card__view{background:rgba(255,255,255,.06)!important;transform:translateY(-2px);}' +
            '.mpx-tab.focus .mpx-tab__ico,.mpx-tab.select .mpx-tab__ico,.mpx-tab:hover .mpx-tab__ico{color:#fff;transform:scale(1.06);}' +
            '.mpx-tab.focus .mpx-tab__lbl,.mpx-tab.select .mpx-tab__lbl,.mpx-tab:hover .mpx-tab__lbl{color:#fff;}';
        try {
            var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
        } catch (e) {}
        applyRadius();
    }

    /* ---------- слушатели ---------- */
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
                if (e.type === 'switch' || e.type === 'change' || e.type === 'changed') {
                    var c = cfg(), prof;
                    try { prof = Lampa.Storage.get('profile', null); } catch (er) { prof = null; }
                    LOG.info('профиль сменён → режим ' + U.mode());
                    if (c.auto_profile === 'on' && prof && prof.params) {
                        if (prof.params.surs || prof.params.multiplex) { try { Lampa.Storage.set('source', NAME); } catch (er) {} }
                        if (prof.params.forKids) { c.mode = 'kids'; saveCfg(c); }
                        else if (prof.params.onlyRus) { c.mode = 'rus'; saveCfg(c); }
                    }
                }
            });
        } catch (e) {}
    }

    /* ---------- lang ---------- */
    function addLang() {
        Lampa.Lang.add({
            mpx_home: { ru: 'Главная', uk: 'Головна', en: 'Home' },
            mpx_rus: { ru: 'Русское', uk: 'Російське', en: 'Russian' },
            mpx_eng: { ru: 'Английское', uk: 'Англійське', en: 'English' },
            mpx_kids: { ru: 'Детское', uk: 'Дитяче', en: 'Kids' },
            mpx_for_you: { ru: 'Под вас', uk: 'Під вас', en: 'For you' },
            mpx_settings: { ru: 'Настройки', uk: 'Налаштування', en: 'Settings' },
            mpx_trending: { ru: 'В тренде', uk: 'У тренді', en: 'Trending' },
            mpx_popular: { ru: 'Популярное', uk: 'Популярне', en: 'Popular' },
            mpx_top: { ru: 'Топ по рейтингу', uk: 'Топ за рейтингом', en: 'Top rated' },
            mpx_box: { ru: 'Кассовые сборы', uk: 'Касові збори', en: 'Box office' },
            mpx_new: { ru: 'Новинки', uk: 'Новинки', en: 'New' }
        });
    }

    /* ---------- старт ---------- */
    function start() {
        LOG.info('старт MULTIPLEX v7 · режим ' + U.mode());
        addLang();
        registerIcon();
        registerSource();
        addSettings();
        addButtonsRow();
        addStyles();
        addListeners();
        LOG.info('запуск завершён');
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });

    window.MULTIPLEX = {
        refresh: function () { try { Lampa.Activity.push({ source: NAME, title: TITLE, component: 'main', page: 1 }); } catch (e) {} },
        cfg: cfg, log: LOG, check: Checker.check
    };
})();
