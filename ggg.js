(function () {
    'use strict';

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;

    const PLUGIN_ID = 'should_watch_plugin';
    const ICON = '<svg viewBox="0 0 100 100" width="30" height="30" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="8" stroke-linecap="square" fill="none"><path d="M20,55 L40,75 L80,25"/><path d="M25,25 L75,75" stroke-dasharray="4,4"/></g></svg>';
    const DISPLAY = '"Trebuchet MS","Segoe UI",system-ui,sans-serif';

    // Глобальные переменные плагина
    const state = {
        rolling: false,
        currentModalHtml: null,
        prevController: null,
        closingFromController: false,
        restoringFocus: false,
        loaderTimer: null,
        focusIdx: 0,
        blocknav: true,
        scrollContainer: null,
        navPoints: [],
        currentNavPoint: 0,
        metaCache: {}
    };

    // ==================== НАСТРОЙКИ ====================
    const Settings = {
        get: (k, d) => {
            try {
                const v = Lampa.Storage.get(`${PLUGIN_ID}_${k}`);
                return v !== undefined && v !== null && v !== '' ? v : d;
            } catch(e) { return d; }
        },
        set: (k, v) => {
            try { Lampa.Storage.set(`${PLUGIN_ID}_${k}`, v); } catch(e) {}
        },
        getAll: () => ({
            bad_genres: String(Settings.get('bad_genres', '') || ''),
            bad_actors: String(Settings.get('bad_actors', '') || ''),
            bad_directors: String(Settings.get('bad_directors', '') || ''),
            min_rating: parseFloat(Settings.get('min_rating', '6')) || 6,
            family_mode: Settings.get('family_mode', '0') === '1'
        }),
        parseList: (s) => s ? s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean) : []
    };

    // ==================== УТИЛИТЫ ====================
    const Utils = {
        esc: (s) => typeof s === 'string' ? $('<div>').text(s).html() : '',
        hasGenre: (genres, re) => genres.some(g => re.test(g.toLowerCase())),
        inText: (s, re) => re.test((s || '').toLowerCase()),
        inAnyText: (texts, re) => texts.some(s => Utils.inText(s, re)),
        mediaType: (m) => (m && m.name && !m.title) ? 'tv' : 'movie',
        mapUSRating: (s) => ({
            'G':0, 'PG':7, 'PG-13':13, 'R':17, 'NC-17':17, 'TV-MA':17, 'TV-14':14, 'TV-PG':7, 'TV-G':0, 'TV-Y7':7, 'TV-Y':0,
            'MA':17, '18':18, '16':16, '12':12, '12A':12, '15':15, '7':7, '6':6, 'U':0, '0':0,
            '0+':0, '6+':6, '12+':12, '16+':16, '18+':18
        }[(s || '').toUpperCase().trim()] || null,
        hasFamilyTags: (ctx) => {
            if (!ctx?.kw?.length) return false;
            const familyKeywords = ['family', 'kids', 'children', 'child', 'family-friendly', 'for kids', 'детский', 'для детей', 'семейный', 'для семьи', 'детям', 'малышам', 'pg', 'g', '0+', '6+', '12+', 'all ages', 'для всех'];
            return ctx.kw.some(kw => familyKeywords.some(tag => kw.toLowerCase().includes(tag)));
        }
    };

    // ==================== СТИЛИ ====================
    function injectStyles() {
        try {
            if (document.getElementById('sw-plugin-styles')) return;

            const styles = `
                .sw-modal-content {
                    padding: 20px 22px 40px;
                    color: #fff;
                    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
                    min-height: 80vh;
                    max-height: 90vh;
                    overflow-y: auto;
                    -webkit-overflow-scrolling: touch;
                    scroll-behavior: smooth;
                    scroll-snap-type: y proximity;
                }
                .sw-modal-content::-webkit-scrollbar { width: 6px; }
                .sw-modal-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,.25); border-radius: 3px; }
                .sw-modal-content::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.35); }
                .sw-modal-content::-webkit-scrollbar-track { background: rgba(0,0,0,.1); }

                .sw-body { animation: swFade .35s ease; }
                .sw-focusable {
                    outline: none;
                    cursor: pointer;
                    scroll-margin-top: 40px;
                    scroll-margin-bottom: 40px;
                }
                .sw-focusable.focus {
                    box-shadow: 0 0 0 3px rgba(255,255,255,.92), 0 0 24px rgba(255,255,255,.22);
                    transition: box-shadow .15s ease;
                }

                .sw-loader {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 18px;
                    padding: 64px 20px;
                    color: #cbd5e1;
                }
                .sw-loader-dice {
                    font-size: 3.2em;
                    line-height: 1;
                    animation: swBounce 1s ease-in-out infinite;
                    filter: drop-shadow(0 4px 12px rgba(133,194,94,.35));
                }
                .sw-loader-text {
                    font-size: 1.1em;
                    font-weight: 600;
                    min-height: 1.4em;
                    transition: opacity .25s;
                    color: #94a3b8;
                }
                .sw-loader-bar {
                    width: 200px;
                    height: 3px;
                    border-radius: 2px;
                    background: rgba(255,255,255,.08);
                    overflow: hidden;
                    position: relative;
                }
                .sw-loader-bar::after {
                    content: "";
                    position: absolute;
                    left: -40%;
                    top: 0;
                    height: 100%;
                    width: 40%;
                    background: linear-gradient(90deg, transparent, #85c25e, transparent);
                    animation: swSlide 1.1s linear infinite;
                }

                .sw-dossier {
                    position: relative;
                    padding: 20px 22px;
                    border-radius: 16px;
                    margin-bottom: 22px;
                    overflow: hidden;
                    background: linear-gradient(160deg, rgba(255,255,255,.06), rgba(255,255,255,.015));
                    border: 1px solid rgba(255,255,255,.08);
                    animation: swRise .5s cubic-bezier(.22,1,.36,1) both;
                    scroll-snap-align: start;
                }
                .sw-dossier::before {
                    content: "";
                    position: absolute;
                    inset: 0;
                    background: radial-gradient(120% 80% at 100% 0%, rgba(133,194,94,.10), transparent 60%);
                    pointer-events: none;
                }
                .sw-verdict-word {
                    font-family: ${DISPLAY};
                    font-size: 2.7em;
                    font-weight: 900;
                    letter-spacing: -.02em;
                    line-height: 1;
                    margin: 0 0 6px;
                    text-transform: uppercase;
                }
                .sw-verdict-word.yes { color: #85c25e; }
                .sw-verdict-word.no { color: #d9534f; }
                .sw-verdict-word.maybe { color: #e0a93b; }
                .sw-verdict-reason {
                    font-size: 1em;
                    color: #c4ccd6;
                    line-height: 1.45;
                    margin: 0 0 16px;
                    max-width: 62ch;
                }
                .sw-meter {
                    height: 10px;
                    border-radius: 6px;
                    background: rgba(0,0,0,.35);
                    overflow: hidden;
                    box-shadow: inset 0 1px 3px rgba(0,0,0,.4);
                }
                .sw-meter-fill {
                    height: 100%;
                    width: 0;
                    border-radius: 6px;
                    transition: width 1s cubic-bezier(.22,1,.36,1);
                }
                .sw-meter-fill.yes { background: #85c25e; }
                .sw-meter-fill.no { background: #d9534f; }
                .sw-meter-fill.maybe { background: #e0a93b; }

                .sw-mode-badge {
                    position: absolute;
                    top: 16px;
                    right: 18px;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    font-size: .7em;
                    padding: 4px 11px;
                    border-radius: 10px;
                    font-weight: 700;
                    letter-spacing: .06em;
                    text-transform: uppercase;
                }
                .sw-mode-badge.tmdb { background: #0d8050; color: #fff; }
                .sw-mode-badge.tags { background: rgba(255,255,255,.15); color: #ccc; }
                .sw-mode-badge.family { background: #6a4c93; color: #fff; }
                .sw-mode-dot {
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    display: inline-block;
                }
                .sw-mode-dot.active {
                    background: #85c25e;
                    animation: swPulse 1.4s ease-in-out infinite;
                }
                .sw-mode-dot.inactive { background: #9aa0a6; }

                .sw-columns {
                    display: flex;
                    justify-content: space-between;
                    gap: 18px;
                    margin-bottom: 20px;
                    flex-wrap: wrap;
                    scroll-snap-align: start;
                }
                .sw-col {
                    flex: 1;
                    min-width: 280px;
                    background: rgba(255,255,255,.04);
                    padding: 15px 17px;
                    border-radius: 12px;
                    border: 1px solid rgba(255,255,255,.06);
                    transition: transform .2s ease, border-color .2s ease, background .2s ease, box-shadow .15s ease;
                }
                .sw-col.focus {
                    box-shadow: 0 0 0 3px rgba(255,255,255,.2);
                    transform: scale(1.02);
                }
                .sw-title {
                    font-family: ${DISPLAY};
                    font-size: 1.02em;
                    font-weight: 800;
                    margin-bottom: 13px;
                    text-transform: uppercase;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    letter-spacing: .03em;
                }
                .sw-title.pros { color: #85c25e; }
                .sw-title.cons { color: #d9534f; }
                .sw-title.target { color: #e0e0e0; }
                .sw-list {
                    margin: 0;
                    padding-left: 18px;
                    font-size: .96em;
                    line-height: 1.5;
                    color: #cdd3db;
                }
                .sw-list li {
                    margin-bottom: 9px;
                    animation: swFade .4s ease both;
                }

                .sw-quote {
                    position: relative;
                    background: rgba(255,255,255,.04);
                    border: 1px solid rgba(255,255,255,.07);
                    border-radius: 14px;
                    padding: 18px 20px 16px 50px;
                    margin-bottom: 20px;
                    scroll-snap-align: start;
                }
                .sw-quote::before {
                    content: "\\"";
                    position: absolute;
                    left: 13px;
                    top: 0;
                    font-size: 3.3em;
                    line-height: 1;
                    color: rgba(255,255,255,.18);
                    font-family: Georgia, serif;
                    font-weight: 700;
                }
                .sw-quote-text {
                    font-size: 1.03em;
                    line-height: 1.55;
                    color: #dfe5ec;
                    font-style: italic;
                }
                .sw-quote-meta {
                    margin-top: 9px;
                    font-size: .82em;
                    color: #8b929c;
                }
                .sw-quote-tone {
                    display: inline-block;
                    padding: 2px 9px;
                    border-radius: 8px;
                    font-style: normal;
                    font-weight: 700;
                    margin-left: 8px;
                    text-transform: uppercase;
                    font-size: .78em;
                    letter-spacing: .05em;
                }
                .sw-quote-tone.pos { background: rgba(133,194,94,.18); color: #9bd07a; }
                .sw-quote-tone.neg { background: rgba(217,83,79,.18); color: #e88; }
                .sw-quote-tone.mix { background: rgba(224,169,59,.18); color: #e7c06a; }

                .sw-target-audience {
                    background: rgba(255,255,255,.04);
                    border: 1px solid rgba(255,255,255,.06);
                    padding: 16px 18px;
                    border-radius: 12px;
                    line-height: 1.6;
                    color: #d6dce4;
                    font-size: 1.02em;
                    margin-bottom: 20px;
                    scroll-snap-align: start;
                }
                .sw-aud-text {
                    font-size: 1.05em;
                    line-height: 1.55;
                    color: #d6dce4;
                }

                .sw-decision {
                    text-align: center;
                    padding: 18px 18px;
                    background: rgba(255,255,255,.03);
                    border-radius: 14px;
                    border: 1px solid rgba(255,255,255,.06);
                    scroll-snap-align: end;
                }
                .sw-decision-hint {
                    font-size: .85em;
                    color: #8b929c;
                    margin-bottom: 12px;
                }
                .sw-dice-btn {
                    background: #eadecd;
                    color: #1a1a1a;
                    font-family: ${DISPLAY};
                    font-size: 1.2em;
                    font-weight: 800;
                    padding: 13px 32px;
                    border-radius: 30px;
                    display: inline-flex;
                    align-items: center;
                    gap: 12px;
                    transition: transform .2s, background .2s, box-shadow .2s;
                    cursor: pointer;
                    outline: none;
                    border: 3px solid transparent;
                }
                .sw-dice-btn.focus {
                    background: #fff;
                    transform: scale(1.05);
                    box-shadow: 0 0 0 3px #fff, 0 0 20px rgba(255,255,255,.4);
                    border-color: #fff;
                }
                .sw-dice-btn.shake { animation: swShake .5s; }
                .sw-verdict-roll {
                    margin-top: 12px;
                    font-family: ${DISPLAY};
                    font-size: 1.45em;
                    font-weight: 900;
                    min-height: 34px;
                    text-transform: uppercase;
                    letter-spacing: .01em;
                    transition: color .2s;
                }
                .sw-verdict-roll.verdict-yes {
                    color: #85c25e !important;
                    text-shadow: 0 0 12px rgba(133,194,94,.35);
                }
                .sw-verdict-roll.verdict-no {
                    color: #d9534f !important;
                    text-shadow: 0 0 12px rgba(217,83,79,.35);
                }

                @keyframes swShake {
                    0%,100% { transform: translate(1px,-2px) rotate(-1deg); }
                    10%,30%,50%,70%,90% { transform: translate(-1px,2px) rotate(1deg); }
                    20%,40%,60%,80% { transform: translate(-3px,0) rotate(0deg); }
                }
                @keyframes swFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes swRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes swBounce { 0%,100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-14px) rotate(6deg); } }
                @keyframes swSlide { 0% { left: -40%; } 100% { left: 100%; } }
                @keyframes swPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(133,194,94,.6); } 50% { box-shadow: 0 0 0 5px rgba(133,194,94,0); } }

                @media (max-width: 640px) {
                    .sw-columns { flex-direction: column; }
                    .sw-verdict-word { font-size: 2.2em; }
                    .sw-col { min-width: auto; }
                }

                .sw-nav-point { scroll-margin-top: 40px; scroll-margin-bottom: 40px; }
                .sw-focusable.nav-point.focus { box-shadow: 0 0 0 4px rgba(255,255,255,.7) !important; }
                html.smooth-scroll { scroll-behavior: smooth; }
            `;

            const styleElement = document.createElement('style');
            styleElement.id = 'sw-plugin-styles';
            styleElement.textContent = styles;
            document.head.appendChild(styleElement);
        } catch(e) { console.error('[SW] injectStyles:', e); }
    }

    // ==================== ЗАГРУЗКА ДАННЫХ ====================
    const DataLoader = {
        tmdbKey: () => {
            try { return Lampa.TMDB?.key || '4ef0d7355d9ffb5151e987764708ce96'; } catch(e) { return '4ef0d7355d9ffb5151e987764708ce96'; }
        },
        get: (path) => new Promise(res => {
            try {
                if (typeof fetch === 'undefined') return res(null);
                fetch(`https://api.themoviedb.org/3${path}&api_key=${DataLoader.tmdbKey()}`)
                    .then(r => r.json())
                    .then(d => res(d?.status_code ? null : d))
                    .catch(() => res(null));
            } catch(e) { res(null); }
        }),
        loadCredits: (movie) => {
            try {
                const id = movie.id || movie.tmdb_id;
                if (!id) return Promise.resolve(null);
                if (movie.credits?.cast?.length || movie.credits?.crew?.length) return Promise.resolve(movie.credits);
                if (Lampa.TMDB?.credits) {
                    return new Promise(res => {
                        Lampa.TMDB.credits(id, d => res(d && !d.status_code ? d : null), () => res(null));
                    });
                }
            } catch(e) { console.error('[SW] loadCredits:', e); }
            return Promise.resolve(null);
        },
        loadMeta: (movie) => {
            const id = movie.id || movie.tmdb_id;
            if (!id) return Promise.resolve({ kw: [], age: null, reviews: [], hasTrailer: false, enOv: '', ruOv: '', genres: [] });
            if (state.metaCache[id]) return Promise.resolve(state.metaCache[id]);

            const type = Utils.mediaType(movie);
            const priorityCountries = ['RU', 'US', 'DE', 'GB', 'FR', 'IT', 'ES', 'CA'];

            return Promise.all([
                DataLoader.get(`/${type}/${id}/keywords?`),
                DataLoader.get(`/${type}/${id}/content_ratings?`),
                DataLoader.get(`/${type}/${id}/reviews?`),
                DataLoader.get(`/${type}/${id}/videos?`),
                DataLoader.get(`/${type}/${id}?language=en-US`),
                DataLoader.get(`/${type}/${id}?`)
            ]).then(arr => {
                const kw = [];
                if (arr[0]) (arr[0].keywords || arr[0].results || []).forEach(k => k?.name && kw.push(k.name.toLowerCase()));

                let age = null;
                if (arr[1]?.results) {
                    for (const country of priorityCountries) {
                        const rating = arr[1].results.find(x => x.iso_3166_1 === country);
                        if (rating?.rating) {
                            const n = parseInt(rating.rating);
                            if (!isNaN(n)) { age = n; break; }
                            const mapped = Utils.mapUSRating(rating.rating);
                            if (mapped !== null) { age = mapped; break; }
                        }
                    }
                    if (age === null && arr[1].results[0]?.rating) {
                        const n = parseInt(arr[1].results[0].rating);
                        age = !isNaN(n) ? n : Utils.mapUSRating(arr[1].results[0].rating);
                    }
                }

                const reviews = arr[2]?.results?.slice(0, 5).map(r => ({
                    author: r.author || 'Аноним',
                    text: (r.content || '').replace(/<[^>]+>/g, '').trim()
                })).filter(r => r.text.length > 20) || [];

                const hasTrailer = arr[3]?.results?.some(v => v.type === 'Trailer' && v.site === 'YouTube') || false;
                const enOv = arr[4]?.overview || '';
                const ruOv = arr[5]?.overview || '';
                const genres = arr[5]?.genres?.map(g => g.name.toLowerCase()) || [];

                const result = { kw, age, reviews, hasTrailer, enOv, ruOv, genres };
                state.metaCache[id] = result;
                return result;
            });
        }
    };

    // ==================== АНАЛИЗ ====================
    const Analyzer = {
        reviewTone: (reviews) => {
            if (!reviews.length) return { tone: null, sample: null };

            const posRe = /шедевр|великолепн|потрясающ|восхитит|блестящ|лучш|мощн|гениальн|masterpiece|brilliant|amazing|great|best|loved|perfect|outstanding|precisely|flawless|must-watch|замечательн|превосходн|отличн/i;
            const negRe = /скучн|ужасн|провал|разочаров|слаб|затян|бессмысл|плох|boring|bad|worst|terrible|awful|disappoint|waste|dull|pointless|ridiculous|утомительн|неинтересн/i;

            let pos = 0, neg = 0, firstNeg = null, firstPos = null;
            reviews.forEach(r => {
                const t = r.text.toLowerCase();
                const p = (t.match(posRe) || []).length;
                const n = (t.match(negRe) || []).length;
                if (p > n) { pos++; if (!firstPos) firstPos = r; }
                else if (n > p) { neg++; if (!firstNeg) firstNeg = r; }
            });

            const tone = (pos === 0 && neg === 0) ? null : (pos > neg + 1 ? 'pos' : (neg > pos + 1 ? 'neg' : 'mix'));
            const sample = (tone === 'neg' ? firstNeg : (tone === 'pos' ? firstPos : (firstNeg || firstPos))) || reviews[0];
            return { tone, sample };
        },

        buildAudience: (pros, cons, genres, rating, familyOK, age, isAnim, ctx) => {
            const hasCult = pros.some(p => /культ|классик|легендарн/i.test(p.toLowerCase()));
            const hasHype = pros.some(p => /хайп|популярн|обсуждаем|тренд/i.test(p.toLowerCase()));
            const hasGem = pros.some(p => /жемчужин|скрыт|недооцен|шедевр/i.test(p.toLowerCase()));
            const hasAction = Utils.hasGenre(genres, /action|боевик|экшен|приключен/i);
            const hasMusic = pros.some(p => /музык|саундтрек|композитор|мелоди/i.test(p.toLowerCase()));
            const hasDoc = Utils.hasGenre(genres, /documentary|документ/i);
            const hasComedy = Utils.hasGenre(genres, /comedy|комеди/i);
            const hasDrama = Utils.hasGenre(genres, /drama|драма/i);
            const hasSciFi = Utils.hasGenre(genres, /sci-fi|fantasy|фантастик|фэнтези/i);
            const hasThriller = Utils.hasGenre(genres, /thriller|horror|триллер|ужас/i);
            const hasCrime = Utils.hasGenre(genres, /crime|криминал|детектив/i);
            const hasAdventure = Utils.hasGenre(genres, /adventure|приключен/i);
            const hasRomance = Utils.hasGenre(genres, /romance|мелодрама|любовн|романтич/i);
            const hasAnimation = Utils.hasGenre(genres, /animation|анимац|мульт/i);

            const hasViolence = cons.some(c => /жесток|насили|кров|убийств|бойн/i.test(c.toLowerCase())) || (ctx?.kw && Utils.hasKw(ctx, /violenc|gore|murder|blood|brutal/));
            const hasDrugs = cons.some(c => /нарко|метамфетамин|кокаин|героин/i.test(c.toLowerCase())) || (ctx?.kw && Utils.hasKw(ctx, /drug|narcotic|meth|cocaine/));
            const hasNudity = cons.some(c => /нагот|обнаж/i.test(c.toLowerCase())) || (ctx?.kw && Utils.hasKw(ctx, /nudity|female nudity|male nudity/));
            const hasStrongLang = cons.some(c => /мат|нецензур/i.test(c.toLowerCase())) || (ctx?.kw && Utils.hasKw(ctx, /profanity|strong language/));

            if (familyOK) return isAnim ? 'Семьям и детям для совместного просмотра' : 'Семьям для совместного просмотра';

            const parts = [];
            if (hasCult && rating >= 8) parts.push('ценит классику');
            else if (hasHype) parts.push('хочет быть в курсе актуального');
            else if (hasGem) parts.push('любит недооценённые фильмы');
            else if (hasAction) parts.push('ищет динамичный сюжет');
            else if (hasThriller) parts.push('любит напряжённые истории');
            else if (hasComedy) parts.push('ищет повод для смеха');
            else if (hasDrama && rating >= 7) parts.push('ценит глубокие истории');
            else if (hasSciFi) parts.push('любит фантастические миры');
            else if (hasDoc) parts.push('интересуется познавательным контентом');
            else if (hasMusic) parts.push('ценит качественную музыку');
            else if (hasAdventure) parts.push('жаждет приключений');
            else if (hasRomance) parts.push('любит романтические истории');
            else if (hasCrime) parts.push('увлекается детективами');
            else if (hasAnimation) parts.push('любит анимацию');
            else if (rating >= 8) parts.push('ценит качественное кино');
            else if (rating >= 6) parts.push('ищет интересный фильм');
            else parts.push('готов экспериментировать');

            let base = 'Тем, кто ' + parts[0];
            const warnings = [];
            if (hasViolence) warnings.push('жёстким сценам');
            if (hasDrugs) warnings.push('темам наркотиков');
            if (hasNudity) warnings.push('откровенным сценам');
            if (hasStrongLang) warnings.push('нецензурной лексике');
            if (age !== null && age >= 18) warnings.push(`взрослому контенту (${age}+)`);
            else if (age !== null && age >= 16) warnings.push(`контенту для старших (${age}+)`);
            else if (age !== null && age >= 12) warnings.push(`контенту для подростков (${age}+)`);

            if (warnings.length > 0) base += ' и не против ' + warnings.join(', ');
            if (isAnim && !familyOK && age !== null && age >= 16) base = 'Фанатам анимации, которые не против ' + warnings.join(', ') || 'взрослого контента';
            return base;
        },

        hasKw: (ctx, re) => ctx?.kw?.some(k => re.test(k)) || false,

        analyze: (movie) => Promise.all([DataLoader.loadCredits(movie), DataLoader.loadMeta(movie)]).then(arr => {
            const credits = arr[0];
            const meta = arr[1];
            const cfg = Settings.getAll();
            const blG = Settings.parseList(cfg.bad_genres);
            const blA = Settings.parseList(cfg.bad_actors);
            const blD = Settings.parseList(cfg.bad_directors);
            const now = new Date().getFullYear();

            // Проверка режима семейного просмотра
            if (cfg.family_mode) {
                const genres = (movie.genres || []).map(g => g.name.toLowerCase());
                const isAnim = Utils.hasGenre(genres, /animation|мульт|анимац|animate/i);
                const hasFamilyGenre = Utils.hasGenre(genres, /family|семейный|детский/i);
                if (!isAnim && !hasFamilyGenre) {
                    return {
                        pros: ['ℹ️ Режим семейного просмотра включён'],
                        cons: ['❌ Фильм не подходит для семейного просмотра'],
                        audience: 'Только для взрослых',
                        review: { tone: null, sample: null },
                        score: -100, norm: 0,
                        vClass: 'no', vWord: 'НЕ СТОИТ',
                        reason: 'Режим семейного просмотра включён. Этот фильм не подходит для семейного просмотра.',
                        mode: 'TAGS',
                        familyOK: false,
                        age: meta.age,
                        isAnim: isAnim
                    };
                }
            }

            const q = (movie.quality || movie.source_quality || '').toString().toUpperCase();
            const rating = parseFloat(movie.vote_average) || 0;
            const votes = parseInt(movie.vote_count) || 0;
            const runtime = parseInt(movie.runtime) || 0;
            const genres = (movie.genres || []).map(g => g.name).filter(Boolean);
            const ovRu = (movie.overview || meta.ruOv || '').trim();
            const ovEn = (meta.enOv || '').trim();
            const ovBoth = [ovRu, ovEn];
            const age = meta.age;
            const yr = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : 0;
            const rt = Analyzer.reviewTone(meta.reviews);
            const dataRich = !!(meta.kw?.length || age !== null || meta.reviews?.length || (credits?.crew?.length));

            const cast = (credits?.cast || []).slice(0, 15).map(c => c.name).filter(Boolean);
            const crew = credits?.crew || [];
            const dirs = crew.filter(c => c.job === 'Director').map(c => c.name).filter(Boolean);
            const wrts = crew.filter(c => ['Writer','Screenplay','Story','Author'].includes(c.job)).map(c => c.name).filter(Boolean);
            const ctx = { kw: meta.kw || [], genres: meta.genres || [] };

            const isAnim = Utils.hasGenre(genres, /animation|мульт|анимац|animate/i);

            // === ЛОГИКА ОПРЕДЕЛЕНИЯ СЕМЕЙНОГО КОНТЕНТА (ОСНОВАНА НА ВОЗРАСТНОМ ОГРАНИЧЕНИИ) ===
            let familyOK;

            // Для мультфильмов - только по возрастному рейтингу
            if (isAnim) {
                if (age !== null) {
                    familyOK = age <= 12; // ≤12 = семейный, >12 = не семейный
                } else {
                    // Если рейтинг неизвестен - проверяем по тегам
                    familyOK = Utils.hasFamilyTags(ctx) || Utils.hasGenre(genres, /family|семейный|детский/i);
                }
            }
            // Для обычных фильмов
            else {
                if (age !== null) {
                    familyOK = age <= 12;
                } else {
                    familyOK = Utils.hasFamilyTags(ctx) || Utils.hasGenre(genres, /family|семейный|детский/i);
                }
            }

            // Проверка режима семейного просмотра
            if (cfg.family_mode && !familyOK) {
                return {
                    pros: ['ℹ️ Режим семейного просмотра включён'],
                    cons: ['❌ Фильм не подходит для семейного просмотра'],
                    audience: 'Только для взрослых',
                    review: { tone: null, sample: null },
                    score: -100, norm: 0,
                    vClass: 'no', vWord: 'НЕ СТОИТ',
                    reason: 'Режим семейного просмотра включён. Этот фильм не подходит для семейного просмотра.',
                    mode: dataRich ? 'TMDB' : 'TAGS',
                    familyOK: false,
                    age: age,
                    isAnim: isAnim
                };
            }

            // === ДЕТЕКЦИЯ ВЗРОСЛОГО КОНТЕНТА ===
            const fDrugs = Utils.inAnyText(ovBoth, /метамфетамин|нарко|кокаин|героин|марихуан|амфетамин/i) || Analyzer.hasKw(ctx, /drug|narcotic|meth|cocaine|heroin/);
            const fNudity = Utils.inAnyText(ovBoth, /обнаж|нагот|голы|эротик/i) || Analyzer.hasKw(ctx, /nudity|female nudity|male nudity/);
            const fSex = Utils.inAnyText(ovBoth, /sex|эротик|откровен|оргазм|проститутк|интимн/i) || Analyzer.hasKw(ctx, /sex scene|sexual content|erotic/) || !!movie.adult;
            const fViol = Utils.inAnyText(ovBoth, /violenc|gore|murder|убийств|кров|жесток|насил|оружи|стрельб/i) || Analyzer.hasKw(ctx, /violenc|gore|murder|blood|weapon/) || Utils.hasGenre(genres, /horror|ужас/i);
            const fSmoke = Utils.inAnyText(ovBoth, /smok|курени|сигарет|табак/i) || Analyzer.hasKw(ctx, /smok|cigarette/);
            const fAlcohol = Utils.inAnyText(ovBoth, /alcohol|пьян|выпив|алкогол/i) || Analyzer.hasKw(ctx, /alcohol|drunk/);
            const fProfanity = Utils.inAnyText(ovBoth, /мат|нецензур|ругательств/i) || Analyzer.hasKw(ctx, /profanity|strong language/);
            const fHate = Utils.inAnyText(ovBoth, /hate|racis|нацист|расизм/i) || Analyzer.hasKw(ctx, /racis|nazi|homophob/);
            const fGamb = Utils.inAnyText(ovBoth, /casino|gambl|казино|ставк/i) || Analyzer.hasKw(ctx, /casino|gambl/);
            const fSuicide = Utils.inAnyText(ovBoth, /суицид|самоубийств/i) || Analyzer.hasKw(ctx, /suicide/);

            const anyAdult = fDrugs || fNudity || fSex || fViol || fSmoke || fAlcohol || fProfanity || fHate || fGamb || fSuicide || !!movie.adult;

            // Для обычных фильмов: если есть взрослый контент, то не семейный
            if (!isAnim && familyOK && anyAdult) {
                familyOK = false;
            }

            // === АРГУМЕНТЫ ===
            const P = [], C = [];
            const addP = (t, w) => P.push({ t, w });
            const addC = (t, w) => C.push({ t, w });

            // Плюсы
            if (familyOK) addP('👨‍👩‍👧‍👦 подходит для семейного просмотра', 25);
            if (rating >= 8.5 && votes >= 5000) addP('⭐ признание зрителей и критиков', 35);
            else if (rating >= 8.0 && votes >= 3000) addP('⭐ высокие оценки', 30);
            else if (rating >= cfg.min_rating && votes >= 500) addP('⭐ стабильно хорошие оценки', 20);
            else if (rating >= cfg.min_rating && votes >= 100) addP('⭐ оценки выше вашего порога', 18);
            if (rating >= 7.8 && votes >= 100 && votes < 1500) addP('🔎 скрытая жемчужина', 18);
            if (rating >= 8.0 && votes >= 2000 && yr > 0 && yr <= now - 3) addP('🏛 культовый фильм', 20);
            if (yr >= now - 1 && votes >= 200) addP('🔥 актуальный фильм', 12);
            if (yr === now) addP('🆕 свежая новинка', 8);
            if (votes > 0 && votes < 30) addC('❓ мало оценок', 12);
            if (votes === 0) addC('⚠️ нет оценок', 15);
            if (rt.tone === 'pos') addP('💬 зрители в восторге', 22);
            else if (rt.tone === 'neg') addC('💬 отрицательные отзывы', 25);
            else if (rt.tone === 'mix') { addP('💬 полярные отзывы', 8); addC('💬 часть разочарована', 10); }
            if (q && !/CAM|TS|HDCAM|SCR|WORKPRINT|TELESYNC|HDRIP|TELECINE/i.test(q)) addP(`🎥 хорошее качество (${q || 'HD'})`, 10);
            if (q && /4K|UHD|2160p/i.test(q)) addP('🎥 отличное 4K-качество', 12);
            if (runtime > 0 && runtime <= 90) addP(`🕐 удобная длительность (${runtime} мин)`, 8);
            if (runtime > 90 && runtime <= 120) addP(`🕐 оптимальная длительность (${runtime} мин)`, 6);
            if (Utils.hasGenre(genres, /documentary|документ/i)) addP('🦉 познавательный фильм', 10);
            if (Utils.inAnyText(ovBoth, /музык|саундтрек|композитор/i) || Analyzer.hasKw(ctx, /music|soundtrack/)) addP('🎵 запоминающаяся музыка', 10);
            if (Utils.hasGenre(genres, /action|боевик/i)) addP('💥 яркий экшен', 10);
            if (meta.hasTrailer) addP('▶ есть трейлер', 6);
            if (Utils.hasGenre(genres, /comedy|комедия/i)) addP('😂 поднимет настроение', 8);
            if (Utils.hasGenre(genres, /adventure|приключения/i)) addP('🌍 увлекательные приключения', 8);
            if (Utils.hasGenre(genres, /sci-fi|фантастика|fantasy|фэнтези/i)) addP('🚀 фантастический мир', 8);
            if (Utils.hasGenre(genres, /drama|драма/i) && rating >= 7.5) addP('🎭 сильная актёрская игра', 8);
            if (isAnim) addP('🎨 анимационный фильм', 5);

            // Минусы
            if (rating > 0 && rating < cfg.min_rating && votes >= 100) addC(`📉 оценки ниже вашего порога (${rating.toFixed(1)})`, 25);
            if (rating > 0 && rating < 5 && votes >= 50) addC(`📉 низкие оценки (${rating.toFixed(1)})`, 30);
            if (genres.filter(g => blG.some(b => g.toLowerCase().includes(b))).length) addC('⛔ нелюбимый жанр: ' + genres.filter(g => blG.some(b => g.toLowerCase().includes(b))).join(', '), 40);
            if (cast.filter(a => blA.some(b => a.toLowerCase().includes(b))).length) addC('⛔ нелюбимый актёр: ' + [...new Set(cast.filter(a => blA.some(b => a.toLowerCase().includes(b))))].slice(0,2).join(', '), 35);
            if ([...dirs, ...wrts].filter(p => blD.some(b => p.toLowerCase().includes(b))).length) addC('⛔ нелюбимый автор: ' + [...new Set([...dirs, ...wrts].filter(p => blD.some(b => p.toLowerCase().includes(b))))].slice(0,2).join(', '), 35);
            if (fNudity) addC('🫣 есть сцены с наготой', 16);
            if (fSex) addC('💋 сексуальные сцены', 16);
            if (fDrugs) addC('💉 тема наркотиков', 18);
            if (fViol) addC('🔪 жестокие сцены', 18);
            if (fSmoke) addC('🚬 показано курение', 8);
            if (fAlcohol) addC('🍺 присутствует алкоголь', 10);
            if (fProfanity) addC('🤬 нецензурная лексика', 10);
            if (fHate) addC('🚩 мотивы ненависти', 20);
            if (fGamb) addC('🎰 тема азартных игр', 12);
            if (fSuicide) addC('⚠️ тема суицида', 20);
            if (runtime > 180) addC(`⌛ длительный фильм (${runtime} мин)`, 12);
            if (runtime > 150 && runtime <= 180) addC(`⌛ довольно длинный (${runtime} мин)`, 8);
            if (/CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT|TELESYNC/i.test(q || '')) addC('📺 плохое качество', 28);
            if (age !== null && age >= 18) addC(`🔞 только для взрослых (${age}+)`, 25);
            else if (age !== null && age >= 16) addC(`🔞 не для детей (${age}+)`, 20);
            else if (age !== null && age >= 12) addC(`🔞 рекомендуется с родителями (${age}+)`, 15);
            if (isAnim && !familyOK) {
                if (age !== null && age > 12) addC(`🎭 мультфильм для взрослых (${age}+)`, 20);
                else addC('🎭 не детский мультфильм', 15);
            }

            // Расчёт оценки
            let score = 0;
            P.forEach(x => score += x.w);
            C.forEach(x => score -= x.w);
            score = Math.max(-100, Math.min(100, score));
            const norm = Math.round((score + 100) / 2);
            const vClass = score >= 25 ? 'yes' : (score <= -25 ? 'no' : 'maybe');
            const vWord = score >= 25 ? 'СТОИТ' : (score <= -25 ? 'НЕ СТОИТ' : 'СПОРНО');

            const topP = P.slice().sort((a,b) => b.w - a.w)[0];
            const topC = C.slice().sort((a,b) => b.w - a.w)[0];
            const strip = t => t ? t.replace(/^[^\s]+\s/, '') : '';

            let reason = '';
            if (vClass === 'yes') reason = (score >= 50 ? 'Определённо стоит' : 'Стоит') + (topP ? ' — ' + strip(topP.t) : '') + '.';
            else if (vClass === 'no') reason = (score <= -50 ? 'Лучше пропустить' : 'Не стоит') + (topC ? ' — ' + strip(topC.t) : '') + '.';
            else reason = 'Вердикт спорный' + (topP && topC ? ': за «' + strip(topP.t) + '», против «' + strip(topC.t) + '».' : '.') + ' Решайте сами.';
            if (!dataRich) reason += ' Данных маловато — вердикт осторожный.';

            const pros = P.map(x => x.t);
            const cons = C.map(x => x.t);
            if (!pros.length) pros.push('ℹ️ данных недостаточно');
            if (!cons.length) cons.push(blG.length || blA.length || blD.length ? '✅ под ваши фильтры ничего не попало' : '✅ явных минусов не выявлено');

            const audience = Analyzer.buildAudience(pros, cons, genres, rating, familyOK, age, isAnim, ctx);
            const modeBadge = dataRich ? 'TMDB' : 'TAGS';

            return {
                pros, cons, audience,
                review: rt, score, norm,
                vClass, vWord, reason,
                mode: cfg.family_mode && familyOK ? 'FAMILY' : modeBadge,
                familyOK, age, isAnim
            };
        })
    };

    // ==================== НАВИГАЦИЯ ====================
    const Navigation = {
        initNavPoints: (html) => {
            try {
                if (!html?.length) return;
                const container = html.find('.sw-modal-content');
                if (!container.length) return;

                state.navPoints = [];
                const points = html.find('.sw-dossier, .sw-columns, .sw-quote, .sw-target-audience, .sw-dice-btn');
                points.each(function() {
                    const $this = $(this);
                    $this.addClass('sw-nav-point');
                    state.navPoints.push($this);
                });

                if (!state.navPoints.length) {
                    state.navPoints = html.find('.sw-focusable');
                }
                state.currentNavPoint = 0;

                // Wheel event
                container.on('wheel', function(e) {
                    if (!state.blocknav) return;
                    e.preventDefault();
                    const delta = e.originalEvent.deltaY || e.originalEvent.wheelDeltaY;
                    if (delta > 0 && state.currentNavPoint < state.navPoints.length - 1) {
                        Navigation.scrollToNavPoint(state.currentNavPoint + 1);
                    } else if (delta < 0 && state.currentNavPoint > 0) {
                        Navigation.scrollToNavPoint(state.currentNavPoint - 1);
                    }
                });

                // Touch events
                let touchStartY = 0;
                container.on('touchstart', function(e) {
                    touchStartY = e.originalEvent.touches[0].clientY;
                });
                container.on('touchmove', function(e) {
                    if (!state.blocknav) return;
                    e.preventDefault();
                    const touchY = e.originalEvent.touches[0].clientY;
                    const diff = touchStartY - touchY;
                    if (diff > 50) {
                        touchStartY = touchY;
                        if (state.currentNavPoint < state.navPoints.length - 1) {
                            Navigation.scrollToNavPoint(state.currentNavPoint + 1);
                        }
                    } else if (diff < -50) {
                        touchStartY = touchY;
                        if (state.currentNavPoint > 0) {
                            Navigation.scrollToNavPoint(state.currentNavPoint - 1);
                        }
                    }
                });
            } catch(e) { console.error('[SW] initNavPoints:', e); }
        },

        scrollToNavPoint: (index) => {
            try {
                if (!state.navPoints?.length) return;
                index = Math.max(0, Math.min(index, state.navPoints.length - 1));
                const point = state.navPoints[index];
                const container = state.scrollContainer;

                if (point?.length && container?.length) {
                    container.animate({ scrollTop: point[0].offsetTop - 20 }, {
                        duration: 300,
                        easing: 'swing',
                        complete: () => {
                            point.addClass('focus');
                            point[0].focus({ preventScroll: true });
                            try { Lampa.Controller.collectionFocus(point); } catch(e) {}
                            state.currentNavPoint = index;
                        }
                    });
                }
            } catch(e) { console.error('[SW] scrollToNavPoint:', e); }
        },

        scrollToElement: (el, container) => {
            try {
                if (!el?.length || !container?.length) return;
                const elTop = el[0].offsetTop;
                const containerTop = container.scrollTop();
                const containerHeight = container.height();
                const elHeight = el[0].offsetHeight;

                if (elTop < containerTop + 20) {
                    container.animate({ scrollTop: elTop - 20 }, 200);
                } else if (elTop + elHeight > containerTop + containerHeight - 20) {
                    container.animate({ scrollTop: elTop - containerHeight + elHeight + 40 }, 200);
                }
            } catch(e) { console.error('[SW] scrollToElement:', e); }
        },

        setFocus: (i) => {
            try {
                const h = state.currentModalHtml;
                if (!h?.length) return;
                const blocks = h.find('.sw-focusable');
                if (!blocks.length) return;

                i = Math.max(0, Math.min(i, blocks.length - 1));
                state.focusIdx = i;

                blocks.removeClass('focus');
                const el = blocks.eq(i);
                el.addClass('focus');

                try { el[0].focus({ preventScroll: true }); } catch(e) { try { el[0].focus(); } catch(_) {} }

                const container = h.find('.sw-modal-content');
                if (container.length) {
                    state.scrollContainer = container;
                    Navigation.scrollToElement(el, container);
                } else {
                    try { el[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch(e) {}
                }

                try { Lampa.Controller.collectionFocus(el); } catch(e) {}
            } catch(e) { console.error('[SW] setFocus:', e); }
        }
    };

    // ==================== КОНТРОЛЛЕР ====================
    const Controller = {
        restorePrev: () => {
            if (state.restoringFocus) return;
            state.restoringFocus = true;

            // Даём время на закрытие модального окна
            setTimeout(() => {
                try {
                    const prev = state.prevController;
                    state.prevController = null;

                    // Пробуем стандартные контроллеры
                    const controllers = [prev?.name, 'full_start', 'full', 'card'].filter(Boolean);
                    for (const ctrl of controllers) {
                        try {
                            Lampa.Controller.toggle(ctrl);
                            break;
                        } catch(e) {}
                    }
                } catch(e) {
                    console.error('[SW] restorePrev error:', e);
                } finally {
                    state.restoringFocus = false;
                }
            }, 50);
        },

        clearLoader: () => {
            if (state.loaderTimer) {
                clearInterval(state.loaderTimer);
                state.loaderTimer = null;
            }
        },

        register: () => {
            try {
                Lampa.Controller.add('should_watch_modal', {
                    toggle: () => {
                        const h = state.currentModalHtml;
                        if (!h?.length) return;
                        if (h[0]) h[0].scrollTop = 0;

                        if (state.blocknav) {
                            const blocks = h.find('.sw-focusable');
                            try { Lampa.Controller.collectionSet(blocks); } catch(e) {}
                            Navigation.setFocus(0);
                            Navigation.initNavPoints(h);
                        }
                    },
                    up: () => {
                        if (state.blocknav) {
                            if (state.navPoints?.length) {
                                const newPoint = state.currentNavPoint - 1;
                                Navigation.scrollToNavPoint(newPoint < 0 ? state.navPoints.length - 1 : newPoint);
                            } else {
                                Navigation.setFocus(state.focusIdx - 1);
                            }
                        }
                    },
                    down: () => {
                        if (state.blocknav) {
                            if (state.navPoints?.length) {
                                const newPoint = state.currentNavPoint + 1;
                                Navigation.scrollToNavPoint(newPoint >= state.navPoints.length ? 0 : newPoint);
                            } else {
                                Navigation.setFocus(state.focusIdx + 1);
                            }
                        }
                    },
                    left: () => {},
                    right: () => {},
                    back: () => {
                        state.rolling = false;
                        state.currentModalHtml = null;
                        state.focusIdx = 0;
                        state.scrollContainer = null;
                        state.navPoints = [];
                        state.currentNavPoint = 0;
                        Controller.clearLoader();
                        state.closingFromController = true;

                        try { Lampa.Modal.close(); } catch(e) {}
                        // restorePrev вызывается в onBack callback
                    }
                });
            } catch(e) { console.error('[SW] registerController:', e); }
        }
    };

    // ==================== РЕНДЕР ====================
    const Renderer = {
        buildInner: (a) => {
            const badgeClass = a.mode === 'TMDB' ? 'tmdb' : (a.mode === 'FAMILY' ? 'family' : 'tags');
            const badge = `<span class="sw-mode-badge ${badgeClass}"><span class="sw-mode-dot active"></span>${a.mode === 'FAMILY' ? 'FAMILY' : (a.mode === 'TMDB' ? 'TMDB' : 'TAGS')}</span>`;

            let quote = '';
            if (a.review?.sample) {
                const toneLabel = a.review.tone === 'pos' ? 'хвалебный' : (a.review.tone === 'neg' ? 'критический' : 'спорный');
                const toneCls = a.review.tone === 'pos' ? 'pos' : (a.review.tone === 'neg' ? 'neg' : 'mix');
                const txt = a.review.sample.text.length > 240 ? a.review.sample.text.substring(0, 240).trim() + '…' : a.review.sample.text;
                quote = `<div class="sw-quote sw-focusable" tabindex="0">
                    <div class="sw-quote-text">${Utils.esc(txt)}</div>
                    <div class="sw-quote-meta">— ${Utils.esc(a.review.sample.author)}, отзыв зрителя
                        <span class="sw-quote-tone ${toneCls}">${toneLabel}</span>
                    </div>
                </div>`;
            }

            const familyIcon = a.familyOK ? '<span style="color:#85c25e; margin-right:8px;">👨‍👩‍👧‍👦</span>' : '';
            const audienceTitle = familyIcon + '🎯 Кому понравится';

            return `
                <div class="sw-dossier sw-focusable sw-nav-point" tabindex="0">
                    ${badge}
                    <div class="sw-verdict-word ${a.vClass}">${a.vWord}</div>
                    <div class="sw-verdict-reason">${Utils.esc(a.reason)}</div>
                    <div class="sw-meter"><div class="sw-meter-fill ${a.vClass}" data-w="${a.norm}"></div></div>
                </div>
                <div class="sw-columns sw-nav-point">
                    <div class="sw-col sw-focusable" tabindex="0">
                        <div class="sw-title pros">✓ Аргументы за</div>
                        <ul class="sw-list">${a.pros.map((p, i) => `<li style="animation-delay:${i * 0.05}s">${Utils.esc(p)}</li>`).join('')}</ul>
                    </div>
                    <div class="sw-col sw-focusable" tabindex="0">
                        <div class="sw-title cons">✗ Аргументы против</div>
                        <ul class="sw-list">${a.cons.map((c, i) => `<li style="animation-delay:${i * 0.05}s">${Utils.esc(c)}</li>`).join('')}</ul>
                    </div>
                </div>
                ${quote}
                <div class="sw-target-audience sw-focusable sw-nav-point" tabindex="0">
                    <div class="sw-title target">${audienceTitle}</div>
                    <div class="sw-aud-text">${Utils.esc(a.audience)}</div>
                </div>
                <div class="sw-decision sw-nav-point">
                    <div class="sw-decision-hint">Вердикт выше — а если колеблешься, доверься случаю</div>
                    <div class="sw-dice-btn selector sw-focusable" id="sw-dice-btn" tabindex="0">
                        <span style="font-size:1.4em">🎲</span> Бросить кости
                    </div>
                    <div class="sw-verdict-roll" id="sw-verdict"></div>
                </div>
            `;
        },

        bindDice: (html) => {
            html.find('#sw-dice-btn').on('hover:enter click keydown', function(e) {
                try {
                    if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                    if (state.rolling) return;
                    state.rolling = true;

                    const btn = $(this);
                    const v = html.find('#sw-verdict');
                    v.attr('style', '').attr('class', 'sw-verdict-roll').text('');
                    btn.addClass('shake');

                    setTimeout(() => {
                        try {
                            btn.removeClass('shake');
                            if (Math.random() > 0.5) {
                                v.text('Смотреть!').addClass('verdict-yes').css({
                                    color: '#85c25e',
                                    textShadow: '0 0 12px rgba(133,194,94,.35)'
                                });
                            } else {
                                v.text('Не смотреть').addClass('verdict-no').css({
                                    color: '#d9534f',
                                    textShadow: '0 0 12px rgba(217,83,79,.35)'
                                });
                            }
                            try { Lampa.Controller.collectionFocus(btn); } catch(e) {}
                            try { btn[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(_) {}
                        } catch(err) { console.error('[SW] dice render:', err); }
                        state.rolling = false;
                    }, 500);
                } catch(err) { console.error('[SW] dice handler:', err); state.rolling = false; }
            });
        },

        showModal: (movie) => {
            try {
                const title = Utils.esc(movie.title || movie.name || 'Фильм');

                // Сохраняем текущий контроллер
                try { state.prevController = Lampa.Controller.enabled ? Lampa.Controller.enabled() : null; }
                catch(e) { state.prevController = null; }

                const phrases = [
                    'Анализирую фильм...',
                    'Подгружаю данные с TMDB...',
                    'Читаю отзывы...',
                    'Проверяю ценз и теги...',
                    'Взвешиваю аргументы...'
                ];

                const html = $(
                    `<div class="sw-modal-content">
                        <div id="sw-body">
                            <div class="sw-loader">
                                <div class="sw-loader-dice">🎲</div>
                                <div class="sw-loader-text" id="sw-loader-text">${phrases[0]}</div>
                                <div class="sw-loader-bar"></div>
                            </div>
                        </div>
                    </div>`
                );

                // Сохраняем состояние
                state.currentModalHtml = html;
                state.focusIdx = 0;
                state.scrollContainer = html;
                state.navPoints = [];
                state.currentNavPoint = 0;

                // Анимация загрузки
                let pi = 0;
                state.loaderTimer = setInterval(() => {
                    pi = (pi + 1) % phrases.length;
                    const t = html.find('#sw-loader-text');
                    if (t.length) {
                        t.css('opacity', 0);
                        setTimeout(() => { t.text(phrases[pi]).css('opacity', 1); }, 200);
                    }
                }, 750);

                // Открываем модальное окно
                Lampa.Modal.open({
                    title: `Стоит ли смотреть: ${title}`,
                    html: html,
                    size: 'large',
                    zIndex: 1000,
                    onBack: () => {
                        state.rolling = false;
                        state.currentModalHtml = null;
                        state.focusIdx = 0;
                        state.scrollContainer = null;
                        state.navPoints = [];
                        state.currentNavPoint = 0;
                        Controller.clearLoader();
                        state.closingFromController = false;
                        Controller.restorePrev();
                    }
                });

                // Анализируем фильм
                Analyzer.analyze(movie).then(a => {
                    Controller.clearLoader();
                    html.find('#sw-body').html(`<div class="sw-body">${Renderer.buildInner(a)}</div>`);
                    Renderer.bindDice(html);

                    // Анимация индикатора
                    setTimeout(() => {
                        html.find('.sw-meter-fill').each(function() {
                            this.style.width = (this.getAttribute('data-w') || 50) + '%';
                        });
                    }, 120);

                    // Фокусируемся на первом элементе
                    setTimeout(() => {
                        Lampa.Controller.toggle('should_watch_modal');
                    }, 50);
                }).catch(err => {
                    Controller.clearLoader();
                    console.error('[SW] analyze:', err);
                    html.find('#sw-body').html(
                        `<div class="sw-body" style="text-align:center;padding:40px;color:#d9534f">
                            Ошибка анализа. Попробуйте позже.
                        </div>`
                    );
                });
            } catch(e) { console.error('[SW] showModal:', e); }
        },

        addButton: (el, movie) => {
            try {
                if (!el?.length || el.find('.sw-custom-button').length) return;

                const btn = $(`
                    <div class="full-start__button selector sw-custom-button" data-type="should_watch">
                        <div class="full-start__icon">${ICON}</div>
                        <span>Стоит ли?</span>
                    </div>
                `);

                btn.on('hover:enter', () => { if (movie) Renderer.showModal(movie); });

                const anchor = el.find('.view--torrent,.view--online,.view--trailer').last();
                if (anchor.length) anchor.after(btn);
                else {
                    const fb = el.find('.full-start__buttons,.full-start-new__buttons,.full-card__buttons');
                    if (fb.length) fb.append(btn);
                }
            } catch(e) { console.error('[SW] addButton:', e); }
        }
    };

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    function initSettings() {
        try {
            if (!window.Lampa || !Lampa.SettingsApi || window.sw_settings_ready) return;
            window.sw_settings_ready = true;

            Lampa.SettingsApi.addComponent({
                component: PLUGIN_ID,
                name: 'Стоит ли смотреть?',
                icon: ICON
            });

            [
                { name: 'bad_genres', type: 'input', title: 'Нелюбимые жанры', description: 'Через запятую', default: '' },
                { name: 'bad_actors', type: 'input', title: 'Нелюбимые актёры', description: 'Через запятую', default: '' },
                { name: 'bad_directors', type: 'input', title: 'Нелюбимые авторы', description: 'Через запятую', default: '' },
                { name: 'min_rating', type: 'select', title: 'Мин. рейтинг', values: {'0':'Любой','5':'5.0','6':'6.0','7':'7.0','8':'8.0'}, default: '6' },
                { name: 'family_mode', type: 'toggle', title: 'Режим семейного просмотра', description: 'Показывать только семейный контент', default: '0' }
            ].forEach(p => {
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: `${PLUGIN_ID}_${p.name}`, type: p.type, values: p.values || '', default: p.default },
                    field: { name: p.title, description: p.description },
                    onChange: val => { Settings.set(p.name, val); }
                });
            });
        } catch(e) { console.error('[SW] initSettings:', e); }
    }

    function startPlugin() {
        try {
            // Определяем тип устройства
            const ua = navigator.userAgent || '';
            const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            const isTV = /TV|SmartTV|HbbTV|Web0S|webOS|Tizen|NetCast|Viera|BRAVIA|CrKey|AFT|FireTV|POVIDE|Maple/i.test(ua);
            state.blocknav = !hasTouch || isTV;

            if (!hasTouch) {
                document.documentElement.classList.add('smooth-scroll');
            }

            // Регистрируем контроллер
            Controller.register();

            // Добавляем кнопку в карточки фильмов
            Lampa.Listener.follow('full', e => {
                if (e.type !== 'complite') return;
                try { Renderer.addButton(e.object.activity.render(), e.data.movie); }
                catch(err) { console.error('[SW]', err); }
            });

            // Инициализируем настройки
            initSettings();

            // Подключаем стили
            injectStyles();

            console.log('[ShouldWatch] v27.0 | Optimized & Fixed');
        } catch(e) { console.error('[SW] startPlugin:', e); }
    }

    // Запускаем плагин
    try {
        if (window.appready) startPlugin();
        else Lampa.Listener.follow('app', e => { if (e.type === 'ready') startPlugin(); });
    } catch(e) { console.error('[SW] init:', e); }
})();
