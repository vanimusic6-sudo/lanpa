(function () {
    'use strict';

    if (window.should_watch_plugin_installed) return;
    window.should_watch_plugin_installed = true;

    var PLUGIN_ID = 'should_watch_plugin';
    var ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    /* ==========================================================================
       НАСТРОЙКИ (ИСПРАВЛЕННЫЕ)
       ========================================================================== */

    function getSetting(key, def) {
        try {
            var val = Lampa.Storage.get(PLUGIN_ID + '_' + key);
            if (val !== undefined && val !== null && val !== '') return val;
        } catch(e) {}
        return def;
    }

    function saveSetting(key, value) {
        try {
            Lampa.Storage.set(PLUGIN_ID + '_' + key, value);
        } catch(e) {}
    }

    function getSettings() {
        return {
            bad_genres: String(getSetting('bad_genres', '') || ''),
            bad_actors: String(getSetting('bad_actors', '') || ''),
            bad_directors: String(getSetting('bad_directors', '') || ''),
            min_rating: parseFloat(getSetting('min_rating', '6')) || 6
        };
    }

    function parseBL(str) {
        if (!str || typeof str !== 'string') return [];
        return str.split(',').map(function(s) { 
            return s.trim().toLowerCase().replace(/\s+/g, ' '); 
        }).filter(Boolean);
    }

    function initSettings() {
        if (!window.Lampa || !Lampa.SettingsApi || window.sw_settings_ready) return;
        window.sw_settings_ready = true;

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: 'Стоит ли смотреть?',
            icon: ICON
        });

        var params = [
            { name: 'bad_genres', type: 'input', title: 'Нелюбимые жанры', description: 'Через запятую: Ужасы, Документальный...', default: '' },
            { name: 'bad_actors', type: 'input', title: 'Нелюбимые актёры', description: 'Через запятую: Адам Сэндлер, Николас Кейдж...', default: '' },
            { name: 'bad_directors', type: 'input', title: 'Нелюбимые авторы', description: 'Режиссёры/сценаристы через запятую', default: '' },
            { name: 'min_rating', type: 'select', title: 'Мин. рейтинг', description: 'Порог для рекомендации "Смотреть"', values: {'0':'Любой','5':'5.0','6':'6.0','7':'7.0','8':'8.0'}, default: '6' }
        ];

        params.forEach(function(p) {
            Lampa.SettingsApi.addParam({
                component: PLUGIN_ID,
                param: { name: PLUGIN_ID + '_' + p.name, type: p.type, values: p.values || '', default: p.default },
                field: { name: p.title, description: p.description },
                onChange: function(val) { 
                    // Прямая запись при изменении — гарантирует сохранение
                    saveSetting(p.name, val); 
                }
            });
        });
    }

    /* ==========================================================================
       СТИЛИ (БОКОВАЯ ПАНЕЛЬ + TV/TOUCH/MOUSE)
       ========================================================================== */

    function injectCSS() {
        if (document.getElementById('sw-plugin-styles')) return;
        var s = document.createElement('style');
        s.id = 'sw-plugin-styles';
        s.innerHTML =
            /* Боковая панель */
            '.sw-side-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:9998;opacity:0;transition:opacity .3s;pointer-events:none}' +
            '.sw-side-overlay.active{opacity:1;pointer-events:auto}' +
            '.sw-side-panel{position:fixed;top:0;right:-480px;width:480px;height:100%;background:#1a1a1a;z-index:9999;transition:right .3s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;box-shadow:-5px 0 30px rgba(0,0,0,.5)}' +
            '.sw-side-panel.active{right:0}' +
            '.sw-panel-header{padding:25px 30px;border-bottom:1px solid rgba(255,255,255,.1);flex-shrink:0}' +
            '.sw-panel-title{font-size:1.3em;font-weight:bold;color:#fff;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.sw-panel-body{flex:1;overflow-y:auto;padding:25px 30px;scroll-behavior:smooth;-webkit-overflow-scrolling:touch}' +
            '.sw-panel-body::-webkit-scrollbar{width:4px}' +
            '.sw-panel-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:2px}' +

            /* Кнопка костей */
            '.sw-dice-section{text-align:center;margin-bottom:30px;padding:20px;background:rgba(255,255,255,.03);border-radius:12px}' +
            '.sw-dice-btn{background:#eadecd;color:#1a1a1a;font-size:1.3em;font-weight:bold;padding:14px 35px;border-radius:30px;display:inline-flex;align-items:center;gap:12px;transition:all .2s;cursor:pointer;outline:none;border:3px solid transparent}' +
            '.sw-dice-btn.focus{background:#fff;transform:scale(1.05);box-shadow:0 0 0 3px #fff,0 0 20px rgba(255,255,255,.4);border-color:#fff}' +
            '.sw-dice-btn.shake{animation:swShake .5s}' +
            '.sw-verdict{margin-top:15px;font-size:1.5em;font-weight:bold;min-height:38px;text-transform:uppercase}' +
            '.sw-verdict.verdict-yes{color:#85c25e!important;text-shadow:0 0 10px rgba(133,194,94,.3)}' +
            '.sw-verdict.verdict-no{color:#d9534f!important;text-shadow:0 0 10px rgba(217,83,79,.3)}' +

            /* Списки */
            '.sw-section{margin-bottom:25px}' +
            '.sw-section-title{font-size:1em;font-weight:bold;margin-bottom:12px;text-transform:uppercase;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:8px}' +
            '.sw-section-title.pros{color:#85c25e}.sw-section-title.cons{color:#d9534f}.sw-section-title.target{color:#e0e0e0}' +
            '.sw-list{margin:0;padding-left:18px;font-size:.9em;line-height:1.5;color:#ccc}' +
            '.sw-list li{margin-bottom:8px}' +
            '.sw-audience-text{color:#ddd;font-size:.95em;line-height:1.6}' +

            /* Анимация */
            '@keyframes swShake{0%,100%{transform:translate(1px,-2px) rotate(-1deg)}10%,30%,50%,70%,90%{transform:translate(-1px,2px) rotate(1deg)}20%,40%,60%,80%{transform:translate(-3px,0) rotate(0deg)}}' +

            /* Адаптация под маленькие экраны */
            '@media(max-width:600px){.sw-side-panel{width:100%;right:-100%}}';
        document.head.appendChild(s);
    }

    /* ==========================================================================
       УТИЛИТЫ И CREDITS
       ========================================================================== */

    function esc(s) { return typeof s === 'string' ? $('<div>').text(s).html() : ''; }

    function loadCredits(movie) {
        if (movie.credits && ((movie.credits.cast && movie.credits.cast.length) || (movie.credits.crew && movie.credits.crew.length))) {
            return Promise.resolve(movie.credits);
        }
        var id = movie.id || movie.tmdb_id;
        if (!id) return Promise.resolve(null);
        if (Lampa.TMDB && typeof Lampa.TMDB.credits === 'function') {
            return new Promise(function(resolve) {
                Lampa.TMDB.credits(id, function(data) {
                    resolve(data && !data.status_code ? data : null);
                }, function() { resolve(null); });
            });
        }
        return Promise.resolve(null);
    }

    /* ==========================================================================
       ГЕНЕРАТОР ВАРИАЦИЙ ТЕКСТА
       ========================================================================== */

    function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    function buildAudience(genre, actor, director, rating, votes, quality, runtime, isSeq, lang, mG, mA, mD) {
        var genrePhrases = [];
        if (genre && !mG.length) {
            genrePhrases = [
                'поклонникам жанра «' + genre + '»',
                'тем, кто получает удовольствие от ' + genre,
                'любителям ' + genre,
                'фанатам направления «' + genre + '»',
                'зрителям, которым близок ' + genre
            ];
        }

        var actorPhrases = [];
        if (actor && !mA.length) {
            actorPhrases = [
                'с участием ' + actor,
                'где играет ' + actor,
                'ради актёрской работы ' + actor,
                'поклонникам таланта ' + actor,
                'тех, кому нравится ' + actor
            ];
        }

        var directorPhrases = [];
        if (director && !mD.length) {
            directorPhrases = [
                'в стиле режиссёра ' + director,
                'от автора ' + director,
                'снятых рукой ' + director,
                'для ценителей почерка ' + director
            ];
        }

        var ratingPhrases = [];
        if (rating >= 7.5 && votes >= 200) {
            ratingPhrases = [
                'высокие оценки зрителей говорят сами за себя',
                'рейтинг ' + rating.toFixed(1) + ' подтверждает качество',
                'тысячи зрителей уже оценили этот фильм высоко',
                'надёжный выбор с рейтингом ' + rating.toFixed(1)
            ];
        } else if (rating >= 6 && votes >= 50) {
            ratingPhrases = [
                'рейтинг ' + rating.toFixed(1) + ' выглядит достойно',
                'оценка ' + rating.toFixed(1) + ' обещает неплохой просмотр',
                'зрители ставят твёрдую ' + rating.toFixed(1)
            ];
        }

        var extraPhrases = [];
        if (quality) extraPhrases.push('доступно в ' + quality);
        if (runtime > 0 && runtime <= 100) extraPhrases.push('идеально на один вечер');
        if (runtime > 150) extraPhrases.push('хватит времени (' + runtime + ' мин.)');
        if (isSeq) extraPhrases.push('часть известной франшизы');
        if (lang === 'ru') extraPhrases.push('оригинал на русском');

        // Выбор структуры предложения (4 варианта)
        var structure = Math.floor(Math.random() * 4);
        var result = '';

        if (structure === 0 && genrePhrases.length && actorPhrases.length) {
            result = pickRandom(genrePhrases) + ', особенно ' + pickRandom(actorPhrases) + '.';
            if (ratingPhrases.length) result += ' ' + pickRandom(ratingPhrases).charAt(0).toUpperCase() + pickRandom(ratingPhrases).slice(1) + '.';
        } else if (structure === 1 && directorPhrases.length) {
            result = 'Фильм ' + pickRandom(directorPhrases) + '.';
            if (genrePhrases.length) result += ' Отличный выбор для ' + pickRandom(genrePhrases) + '.';
        } else if (structure === 2 && ratingPhrases.length) {
            result = pickRandom(ratingPhrases).charAt(0).toUpperCase() + pickRandom(ratingPhrases).slice(1) + '.';
            if (extraPhrases.length) result += ' Бонусом: ' + extraPhrases.slice(0, 2).join(', ') + '.';
        } else {
            var allParts = [].concat(genrePhrases, actorPhrases, directorPhrases, ratingPhrases, extraPhrases);
            if (allParts.length >= 2) {
                result = 'Подойдёт ' + pickRandom(allParts) + '; также ' + pickRandom(allParts.filter(function(p){return p !== result;})) + '.';
            } else if (allParts.length === 1) {
                result = 'Может понравиться ' + allParts[0] + '.';
            } else {
                result = 'Нет явных противопоказаний — можно попробовать.';
            }
        }

        return result.charAt(0).toUpperCase() + result.slice(1);
    }

    /* ==========================================================================
       АНАЛИЗАТОР v9
       ========================================================================== */

    function analyze(movie) {
        return loadCredits(movie).then(function(credits) {
            var cfg = getSettings();
            var blG = parseBL(cfg.bad_genres);
            var blA = parseBL(cfg.bad_actors);
            var blD = parseBL(cfg.bad_directors);
            var minR = cfg.min_rating;

            var r = parseFloat(movie.vote_average) || 0;
            var vc = parseInt(movie.vote_count) || 0;
            var genres = (movie.genres || []).map(function(g){return g.name;}).filter(Boolean);
            var ov = (movie.overview || '').trim();
            var rt = parseInt(movie.runtime) || 0;
            var lang = movie.original_language || '';
            var adult = !!movie.adult;
            var seq = !!movie.belongs_to_collection;
            var origTitle = movie.original_title || movie.original_name || '';
            var kpRating = parseFloat(movie.rating_kp) || 0;
            var imdbRating = parseFloat(movie.rating_imdb) || 0;

            var qualityStr = (movie.quality || movie.source_quality || '').toString().toUpperCase();
            var maxQuality = '';
            if (/2160|4K|UHD/.test(qualityStr)) maxQuality = '4K UHD';
            else if (/1080|FHD|FULLHD/.test(qualityStr)) maxQuality = 'Full HD 1080p';
            else if (/720|HD/.test(qualityStr)) maxQuality = 'HD 720p';
            else if (/WEB-DL|WEBRIP/i.test(qualityStr)) maxQuality = 'WEB-DL';
            else if (/BDRIP|BLURAY/i.test(qualityStr)) maxQuality = 'BluRay';
            else if (qualityStr) maxQuality = qualityStr;
            var isBadQuality = /CAM|TS|HDCAM|HDRIP|TELECINE|SCR|WORKPRINT/i.test(qualityStr);

            var cast = (credits && credits.cast || []).slice(0, 15).map(function(c){return c.name;}).filter(Boolean);
            var crew = credits && credits.crew || [];
            var dirs = crew.filter(function(c){return c.job === 'Director';}).map(function(c){return c.name;}).filter(Boolean);
            var wrts = crew.filter(function(c){return ['Writer','Screenplay','Story','Author'].indexOf(c.job) >= 0;}).map(function(c){return c.name;}).filter(Boolean);

            var P = [], C = [];

            // Чёрные списки (строгий поиск подстроки)
            var mG = genres.filter(function(g){ var gl = g.toLowerCase(); return blG.some(function(b){return gl.indexOf(b) >= 0;}); });
            var mA = cast.filter(function(a){ var al = a.toLowerCase(); return blA.some(function(b){return al.indexOf(b) >= 0;}); });
            var mD = [].concat(dirs, wrts).filter(function(p){ var pl = p.toLowerCase(); return blD.some(function(b){return pl.indexOf(b) >= 0;}); });
            if (mG.length) C.push('⛔ Нелюбимый жанр: ' + mG.join(', '));
            if (mA.length) C.push('⛔ Нелюбимый актёр: ' + [...new Set(mA)].slice(0,2).join(', '));
            if (mD.length) C.push('⛔ Нелюбимый автор: ' + [...new Set(mD)].slice(0,2).join(', '));

            if (isBadQuality) C.push('📺 Низкое качество: ' + (qualityStr || 'CAM/TS'));
            if (maxQuality && !isBadQuality) P.push('🎬 Макс. качество: ' + maxQuality);

            var adKeywords = ['казино','casino','бетсити','betcity','1xbet','винлайн','winline','фонбет','fonbet','ставка','ставки на спорт','букмекер','bookmaker','промокод','promocode','спонсор'];
            var ovLower = ov.toLowerCase();
            var fAds = adKeywords.filter(function(kw){return ovLower.indexOf(kw) >= 0;});
            if (fAds.length) C.push('🎰 Возможна реклама: ' + fAds.slice(0,3).join(', '));

            var plotBad = (r > 0 && r < 5 && vc >= 100) || (kpRating > 0 && kpRating < 5 && imdbRating > 0 && imdbRating < 5);
            var badWords = ['скучный','предсказуемый','затянутый','нелогичный','дыры в сюжете','слабый сюжет','boring','predictable','plot holes'];
            var hasBadW = badWords.some(function(w){return ovLower.indexOf(w) >= 0;});
            if (plotBad && hasBadW) C.push('👎 Плохой сюжет по мнению зрителей');
            else if (plotBad) C.push('👎 Слабые оценки зрителей');

            if (r > 0 && r < minR) C.push('📉 Рейтинг ' + r.toFixed(1) + ' ниже порога (' + minR + ')');
            if (vc < 30 && r > 0) C.push('❓ Всего ' + vc + ' оценок');
            if (r >= minR && vc >= 200) P.push('⭐ Надёжный рейтинг: ' + r.toFixed(1) + ' (' + vc + ')');
            else if (r >= minR && vc >= 50) P.push('⭐ Рейтинг ' + r.toFixed(1) + ' (' + vc + ')');
            if (r >= 8 && vc >= 500) P.push('🏆 Выбор зрителей: ' + r.toFixed(1));
            if (!ov) C.push('📭 Нет описания сюжета');
            else if (ov.length < 40) C.push('📝 Короткое описание');
            else if (ov.length > 300) P.push('📖 Развёрнутая аннотация');
            if (rt > 200) C.push('⏱ Эпик: ' + rt + ' мин.');
            else if (rt > 0 && rt <= 130) P.push('⏱ Комфортно: ' + rt + ' мин.');
            if (dirs.length && !mD.length) P.push('🎬 Режиссёр: ' + dirs[0]);
            if (wrts.length && !mD.length) P.push('✍️ Сценарист: ' + wrts[0]);
            if (cast.length > 0 && !mA.length) P.push('🎭 В ролях: ' + cast.slice(0,3).join(', '));
            if (genres.length && !mG.length) P.push('🎞 ' + genres.slice(0,2).join(', '));
            if (lang === 'ru') P.push('🇷🇺 Русский язык');
            if (adult) C.push('🔞 Контент 18+');
            if (seq) P.push('🔗 Часть франшизы');
            if (origTitle && origTitle !== movie.title && origTitle !== movie.name) P.push('🏷 Ориг.: ' + origTitle);
            if (!P.length) P.push('ℹ️ Недостаточно метаданных');
            if (!C.length) C.push('✅ Противопоказаний не выявлено');

            // Живая рекомендация с вариациями
            var audience = buildAudience(
                genres.length && !mG.length ? genres[0] : null,
                cast.length && !mA.length ? cast[0] : null,
                dirs.length && !mD.length ? dirs[0] : null,
                r, vc, maxQuality && !isBadQuality ? maxQuality : null,
                rt, seq, lang, mG, mA, mD
            );

            return { pros: P, cons: C, audience: audience };
        });
    }

    /* ==========================================================================
       БОКОВАЯ ПАНЕЛЬ (TV + MOUSE + TOUCH)
       ========================================================================== */

    var panelOverlay = null;
    var panelEl = null;
    var panelBody = null;
    var isRolling = false;
    var touchStartY = 0;
    var touchVelocity = 0;
    var inertiaRaf = null;

    function createPanel() {
        if (panelEl) return;

        panelOverlay = $('<div class="sw-side-overlay"></div>');
        panelEl = $('<div class="sw-side-panel"><div class="sw-panel-header"><div class="sw-panel-title"></div></div><div class="sw-panel-body"></div></div>');
        panelBody = panelEl.find('.sw-panel-body');

        $('body').append(panelOverlay).append(panelEl);

        // Закрытие по клику на оверлей
        panelOverlay.on('click', closePanel);

        // Сенсорный скролл
        panelBody[0].addEventListener('touchstart', function(e) {
            cancelInertia();
            touchStartY = e.touches[0].clientY;
            touchVelocity = 0;
        }, { passive: true });

        panelBody[0].addEventListener('touchmove', function(e) {
            var y = e.touches[0].clientY;
            var dy = touchStartY - y;
            panelBody.scrollTop(panelBody.scrollTop() + dy);
            touchVelocity = dy;
            touchStartY = y;
        }, { passive: true });

        panelBody[0].addEventListener('touchend', function() {
            startInertia(touchVelocity);
        }, { passive: true });
    }

    function cancelInertia() {
        if (inertiaRaf) { cancelAnimationFrame(inertiaRaf); inertiaRaf = null; }
    }

    function startInertia(velocity) {
        cancelInertia();
        var friction = 0.92;
        var minV = 0.5;
        function step() {
            if (Math.abs(velocity) < minV) { inertiaRaf = null; return; }
            panelBody.scrollTop(panelBody.scrollTop() + velocity);
            velocity *= friction;
            inertiaRaf = requestAnimationFrame(step);
        }
        inertiaRaf = requestAnimationFrame(step);
    }

    function openPanel(title, contentHtml) {
        createPanel();
        panelEl.find('.sw-panel-title').text(title);
        panelBody.html(contentHtml);
        panelOverlay.addClass('active');
        panelEl.addClass('active');

        // Фокус на кнопку костей
        setTimeout(function() {
            var btn = panelBody.find('#sw-dice-btn');
            if (btn.length) Lampa.Controller.collectionFocus(btn);
        }, 350);
    }

    function closePanel() {
        cancelInertia();
        isRolling = false;
        if (panelOverlay) panelOverlay.removeClass('active');
        if (panelEl) panelEl.removeClass('active');
        Lampa.Controller.toggle('full');
    }

    /* ==========================================================================
       КОНТРОЛЛЕР ДЛЯ БОКОВОЙ ПАНЕЛИ
       ========================================================================== */

    function registerController() {
        Lampa.Controller.add('should_watch_panel', {
            toggle: function() {
                if (panelBody) {
                    Lampa.Controller.collectionSet(panelBody);
                    var btn = panelBody.find('#sw-dice-btn');
                    if (btn.length) Lampa.Controller.collectionFocus(btn);
                }
            },
            up: function() {
                if (panelBody && panelBody.scrollTop() > 0) {
                    panelBody.animate({ scrollTop: panelBody.scrollTop() - 100 }, 100);
                }
            },
            down: function() {
                if (panelBody) {
                    var max = panelBody[0].scrollHeight - panelBody.outerHeight();
                    if (panelBody.scrollTop() < max) {
                        panelBody.animate({ scrollTop: panelBody.scrollTop() + 100 }, 100);
                    }
                }
            },
            left: function() {},
            right: function() {},
            back: function() { closePanel(); }
        });
    }

    /* ==========================================================================
       ПОКАЗАТЬ ПАНЕЛЬ
       ========================================================================== */

    function showPanel(movie) {
        var title = movie.title || movie.name || 'Фильм';
        var loading = '<div style="text-align:center;padding:60px"><div style="font-size:2em;margin-bottom:15px">⏳</div><div style="color:#ccc">Анализируем...</div></div>';

        openPanel('Стоит ли смотреть: ' + title, loading);
        Lampa.Controller.toggle('should_watch_panel');

        analyze(movie).then(function(a) {
            var html = $(
                '<div class="sw-dice-section">' +
                    '<div class="sw-dice-btn selector" id="sw-dice-btn"><span style="font-size:1.3em">🎲</span> Бросить кости</div>' +
                    '<div class="sw-verdict" id="sw-verdict"></div>' +
                '</div>' +
                '<div class="sw-section"><div class="sw-section-title pros">Почему стоит ✓</div><ul class="sw-list">' + a.pros.map(function(p){return '<li>' + esc(p) + '</li>';}).join('') + '</ul></div>' +
                '<div class="sw-section"><div class="sw-section-title cons">Почему не стоит ✗</div><ul class="sw-list">' + a.cons.map(function(c){return '<li>' + esc(c) + '</li>';}).join('') + '</ul></div>' +
                '<div class="sw-section"><div class="sw-section-title target">Кому посмотреть? 🎯</div><div class="sw-audience-text">' + esc(a.audience) + '</div></div>'
            );

            panelBody.html(html);

            html.find('#sw-dice-btn').on('hover:enter click keydown', function(e) {
                if (e.type === 'keydown' && e.keyCode !== 13 && e.keyCode !== 32) return;
                if (isRolling) return;
                isRolling = true;
                var btn = $(this), v = html.find('#sw-verdict');
                v.attr('style', '').attr('class', 'sw-verdict').text('');
                btn.addClass('shake');
                setTimeout(function() {
                    btn.removeClass('shake');
                    if (Math.random() > 0.5) {
                        v.text('Смотреть!').addClass('verdict-yes').css({color:'#85c25e',textShadow:'0 0 10px rgba(133,194,94,.3)'});
                    } else {
                        v.text('Не смотреть').addClass('verdict-no').css({color:'#d9534f',textShadow:'0 0 10px rgba(217,83,79,.3)'});
                    }
                    Lampa.Controller.collectionFocus(btn);
                    isRolling = false;
                }, 500);
            });

            // Возвращаем фокус на кнопку после загрузки
            setTimeout(function() {
                var btn = panelBody.find('#sw-dice-btn');
                if (btn.length) Lampa.Controller.collectionFocus(btn);
            }, 100);
        });
    }

    /* ==========================================================================
       ИНЪЕКЦИЯ КНОПКИ
       ========================================================================== */

    function addBtn(el, movie) {
        if (!el || !el.length || el.find('.sw-custom-button').length) return;
        var btn = $('<div class="full-start__button selector sw-custom-button" data-type="should_watch"><div class="full-start__icon">' + ICON + '</div><span>Стоит ли?</span></div>');
        btn.on('hover:enter click', function() { if (movie) showPanel(movie); });
        var anchor = el.find('.view--torrent,.view--online,.view--trailer').last();
        if (anchor.length) anchor.after(btn);
        else {
            var fb = el.find('.full-start__buttons,.full-start-new__buttons,.full-card__buttons');
            if (fb.length) fb.append(btn);
        }
    }

    /* ==========================================================================
       ЗАПУСК
       ========================================================================== */

    function startPlugin() {
        try {
            Lampa.Listener.follow('full', function(e) {
                if (e.type !== 'complite') return;
                try { addBtn(e.object.activity.render(), e.data.movie); } catch(err) { console.error('[SW]', err); }
            });
        } catch(err) {}
        try { initSettings(); } catch(err) {}
        try { injectCSS(); } catch(err) {}
        try { registerController(); } catch(err) {}
        console.log('[ShouldWatch] v9.0 Side Panel initialized.');
    }

    try {
        if (window.appready) startPlugin();
        else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') startPlugin(); });
    } catch(e) {}

})();
