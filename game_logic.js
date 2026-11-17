/**
 * game_logic.js
 * ------------------------------------------------------------------
 * Pure game logic for "I Bet You Can't Find It On A Map" — no DOM,
 * no Three.js, no browser APIs.  All functions are plain JS so they
 * can be unit-tested in Node.js and reused in any front-end.
 *
 * Exports (CommonJS for Node, global for browser):
 *   shuffle, pickRandom, pickRandomCapital, generateMainQuestion,
 *   generateBonusQuestions, fetchWikiSummary, splitSentences,
 *   cleanSentence, computeScore
 * ------------------------------------------------------------------
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory(require('./capitals_data'), require('./water_bodies'));
    } else {
        // Browser: WORLD_CAPITALS / WATER_BODIES are script-scope consts.
        // Try window first, then fall back to bare names.
        var caps = root.WORLD_CAPITALS;
        if (!caps && typeof WORLD_CAPITALS !== 'undefined') caps = { WORLD_CAPITALS: WORLD_CAPITALS };
        var water = root.WATER_BODIES;
        if (!water && typeof WATER_BODIES !== 'undefined') {
            water = { WATER_BODIES: WATER_BODIES, findNearestWater: root.findNearestWater || (typeof findNearestWater !== 'undefined' ? findNearestWater : null) };
        }
        root.GameLogic = factory(caps, water);
    }
}(typeof self !== 'undefined' ? self : this, function (WORLD_CAPITALS_REF, WATER_REF) {

    const WORLD_CAPITALS = WORLD_CAPITALS_REF.WORLD_CAPITALS || WORLD_CAPITALS_REF;
    const WATER_BODIES = (WATER_REF && (WATER_REF.WATER_BODIES || WATER_REF)) || [];
    const findNearestWater = (WATER_REF && WATER_REF.findNearestWater) || null;

    // ──────────────────────────────────────────────────────────────
    //  Utility helpers
    // ──────────────────────────────────────────────────────────────

    /** Fisher-Yates shuffle (returns a new array). */
    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    /** Pick n distinct random elements from arr. */
    function pickRandom(arr, n) {
        return shuffle(arr).slice(0, n);
    }

    /** Pick a random capital from the dataset, avoiding a given set. */
    function pickRandomCapital(excludeSet) {
        const pool = excludeSet && excludeSet.size > 0
            ? WORLD_CAPITALS.filter(c => !excludeSet.has(c.capital + '|' + c.country))
            : WORLD_CAPITALS;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** Escape a string for use in a RegExp. */
    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ──────────────────────────────────────────────────────────────
    //  Sentence processing (for Wikipedia extract questions)
    // ──────────────────────────────────────────────────────────────

    /**
     * Split a block of text into individual sentences.
     * Handles common abbreviations and decimal numbers.
     */
    function splitSentences(text) {
        if (!text) return [];
        // Protect decimal numbers (e.g. 2.04) from being split on.
        let t = text
            .replace(/(\d)\.(\d)/g, '$1\u0002$2')
            // Protect single-letter abbreviations like U.S. or U.K.
            .replace(/\b([A-Z])\./g, '$1\u0001');
        // Split on sentence-ending punctuation followed by whitespace
        // and a capital letter (so "U.S. and" is not split).
        const raw = t.split(/(?<=[.!?])\s+(?=[A-Z"""])/);
        return raw.map(s =>
            s.replace(/\u0001/g, '.').replace(/\u0002/g, '.').trim()
        ).filter(s => s.length > 0);
    }

    /**
     * Replace the capital name and country name in a sentence with
     * generic placeholders so that the same template works as either a
     * correct answer or a neutralised distractor.
     *
     * @param {string} sentence  – the raw Wikipedia sentence
     * @param {object} capital   – { capital, country } or null
     * @returns {string} cleaned sentence
     */
    function cleanSentence(sentence, capital) {
        let s = sentence;
        if (capital) {
            // Replace capital name at word boundaries
            const capRe = new RegExp('\\b' + escapeRegex(capital.capital) + '\\b', 'gi');
            s = s.replace(capRe, 'This city');
            // Replace country name
            const countryRe = new RegExp(escapeRegex(capital.country), 'gi');
            s = s.replace(countryRe, 'its country');
        }
        // Clean up leading "This city This city" from overlapping replacements
        s = s.replace(/(This city\s+)+This city/g, 'This city');
        s = s.replace(/\s{2,}/g, ' ').trim();
        // Ensure it ends with a period
        if (s && !s.match(/[.!?]$/)) s += '.';
        return s;
    }

    /**
     * Pick sentences from an extract that are "good" for trivia — not
     * too short, not too long, and not just a bare "X is the capital".
     */
    function pickGoodSentences(extract) {
        const sentences = splitSentences(extract);
        return sentences.filter(s => {
            if (s.length < 40 || s.length > 220) return false;
            // Skip sentences that are just "X is the capital of Y"
            if (/^this city is (the )?capital/i.test(s)) return false;
            // Skip if it's mostly just naming the capital
            if (s.split(' ').length < 8) return false;
            return true;
        });
    }

    // ──────────────────────────────────────────────────────────────
    //  Wikipedia API
    // ──────────────────────────────────────────────────────────────

    /** In-memory cache so we never fetch the same capital twice. */
    const wikiCache = new Map();

    /**
     * Fetch the Wikipedia REST summary for a capital city.
     * Returns { title, description, extract, thumbnail } or null.
     * Works in the browser (fetch + CORS) and in Node (no fetch in
     * older Node, so we guard).
     */
    async function fetchWikiSummary(capitalName) {
        const key = capitalName.toLowerCase();
        if (wikiCache.has(key)) return wikiCache.get(key);

        const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' +
            encodeURIComponent(capitalName.replace(/ /g, '_'));

        try {
            // Use global fetch (browser) or node-fetch if available
            const fetchFn = (typeof fetch !== 'undefined') ? fetch :
                (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;
            if (!fetchFn) {
                wikiCache.set(key, null);
                return null;
            }
            const res = await fetchFn(url);
            if (!res.ok) {
                wikiCache.set(key, null);
                return null;
            }
            const data = await res.json();
            // Skip disambiguation / no-extract pages
            if (data.type === 'disambiguation' || !data.extract) {
                wikiCache.set(key, null);
                return null;
            }
            const summary = {
                title: data.title,
                description: data.description || null,
                extract: data.extract,
                thumbnail: (data.thumbnail && data.thumbnail.source) || null,
                wikiUrl: (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) || null
            };
            wikiCache.set(key, summary);
            return summary;
        } catch (e) {
            wikiCache.set(key, null);
            return null;
        }
    }

    /** Pre-populate cache (used in tests). */
    function _primeCache(name, data) {
        wikiCache.set(name.toLowerCase(), data);
    }

    // ──────────────────────────────────────────────────────────────
    //  Question generators
    // ──────────────────────────────────────────────────────────────

    /**
     * Generate the main multiple-choice question:
     *   "What is the capital of [country]?"
     *
     * @param {object} capital    – the correct capital entry
     * @param {array}  allCapitals – full dataset
     * @returns {{ question, flag, country, options: string[], correctAnswer: string }}
     */
    function generateMainQuestion(capital, allCapitals) {
        const pool = allCapitals || WORLD_CAPITALS;

        // Build distractors: prefer capitals from the same region for
        // a fairer challenge, fall back to any.
        const sameRegion = pool.filter(c =>
            c.region === capital.region &&
            c.capital !== capital.capital
        );
        const otherRegion = pool.filter(c =>
            c.region !== capital.region &&
            c.capital !== capital.capital
        );

        let distractorPool = sameRegion.length >= 3 ? sameRegion :
            sameRegion.concat(otherRegion);

        // Deduplicate by capital name so we don't show "Kingston" twice
        const seen = new Set([capital.capital]);
        const distractors = [];
        const shuffled = shuffle(distractorPool);
        for (const c of shuffled) {
            if (!seen.has(c.capital)) {
                seen.add(c.capital);
                distractors.push(c.capital);
            }
            if (distractors.length >= 3) break;
        }

        const options = shuffle([capital.capital, ...distractors]);

        return {
            type: 'main',
            question: 'What is the capital of ' + capital.country + '?',
            flag: capital.flag,
            country: capital.country,
            options: options,
            correctAnswer: capital.capital,
            capitalData: capital
        };
    }

    /**
     * Generate a "nearest body of water" bonus question.
     *
     * Uses Haversine distance from the capital's coordinates to each
     * water body centre (deduplicating oceans with multiple centres).
     * The nearest water body is the correct answer; 3 distractors are
     * picked from water bodies that are farther away, with a mix of
     * types for a challenging but fair question.
     *
     * @param {object} capital      – { capital, lat, lng }
     * @param {array}  waterBodies  – array of { name, type, lat, lng }
     * @returns {object|null} question
     */
    function generateWaterQuestion(capital, waterBodies) {
        const wbs = waterBodies || WATER_BODIES;
        if (!wbs || wbs.length < 5) return null;
        if (typeof capital.lat !== 'number' || typeof capital.lng !== 'number') return null;

        const lookup = (findNearestWater || _findNearestWaterFallback)(
            capital.lat, capital.lng, wbs
        );
        if (lookup.length < 4) return null;

        const correct = lookup[0]; // nearest
        const questionTemplates = [
            'Which body of water is closest to ' + capital.capital + '?',
            'Which of these bodies of water is nearest to ' + capital.capital + '?',
            'Which body of water is adjacent to or near ' + capital.capital + '?',
            'Which body of water can be found near ' + capital.capital + '?'
        ];

        // Build distractor pool — everything except the correct answer,
        // and at least 25% farther away to avoid ambiguity.
        const minDist = correct.dist * 1.25;
        let pool = lookup.slice(1).filter(function (d) {
            return d.dist >= minDist;
        });
        // Fallback: if the filter leaves fewer than 3, relax the threshold
        if (pool.length < 3) pool = lookup.slice(1);

        // Mix distractor types: prefer 2 of a different type and 1 of
        // the same type as the correct answer.
        const used = new Set([correct.name]);
        const distractors = [];
        const diffType = shuffle(pool.filter(function (d) { return d.type !== correct.type; }));
        const sameType = shuffle(pool.filter(function (d) { return d.type === correct.type; }));

        for (let i = 0; i < diffType.length && distractors.length < 3; i++) {
            if (!used.has(diffType[i].name)) {
                distractors.push(diffType[i].name);
                used.add(diffType[i].name);
            }
        }
        for (let i = 0; i < sameType.length && distractors.length < 3; i++) {
            if (!used.has(sameType[i].name)) {
                distractors.push(sameType[i].name);
                used.add(sameType[i].name);
            }
        }

        if (distractors.length < 3) return null;

        const options = shuffle([correct.name, ...distractors]);
        return {
            type: 'bonus-water',
            question: questionTemplates[Math.floor(Math.random() * questionTemplates.length)],
            options: options,
            correctAnswer: correct.name
        };
    }

    // Fallback if water_bodies.js didn't provide findNearestWater
    function _findNearestWaterFallback(lat, lng, wbs) {
        const byName = new Map();
        for (let i = 0; i < wbs.length; i++) {
            const wb = wbs[i];
            const dLat = (wb.lat - lat) * Math.PI / 180;
            const dLng = (wb.lng - lng) * Math.PI / 180;
            const dLngN = Math.atan2(Math.sin(dLng), Math.cos(dLng));
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lat * Math.PI / 180) * Math.cos(wb.lat * Math.PI / 180) *
                      Math.sin(dLngN / 2) * Math.sin(dLngN / 2);
            const dist = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            if (!byName.has(wb.name) || dist < byName.get(wb.name).dist) {
                byName.set(wb.name, { name: wb.name, type: wb.type, dist: dist });
            }
        }
        const arr = [];
        byName.forEach(function (v) { arr.push(v); });
        arr.sort(function (a, b) { return a.dist - b.dist; });
        return arr;
    }

    /**
     * Generate bonus multiple-choice questions from the Wikipedia
     * summary of the capital plus data derived from the dataset.
     *
     * @param {object} capital       – the capital entry (main answer)
     * @param {object|null} wiki     – { description, extract } from Wikipedia
     * @param {array}  otherWikis    – array of { description, extract } for distractors
     * @param {array}  allCapitals   – full dataset (for data-based Qs)
     * @returns {array} questions  – each { type, question, options, correctAnswer }
     */
    function generateBonusQuestions(capital, wiki, otherWikis, allCapitals) {
        const pool = allCapitals || WORLD_CAPITALS;
        const questions = [];

        // ── Type 1: Wikipedia description ────────────────────────
        if (wiki && wiki.description) {
            const distractors = otherWikis
                .map(w => w && w.description)
                .filter(d => d && d !== wiki.description);
            if (distractors.length >= 3) {
                const opts = shuffle([wiki.description, ...pickRandom(distractors, 3)]);
                questions.push({
                    type: 'bonus-description',
                    question: 'Wikipedia describes ' + capital.capital + ' as which of the following?',
                    options: opts,
                    correctAnswer: wiki.description
                });
            }
        }

        // ── Type 2: Wikipedia extract fact ────────────────────────
        if (wiki && wiki.extract) {
            const goodSentences = pickGoodSentences(wiki.extract);
            if (goodSentences.length > 0) {
                // Pick up to 2 different sentences as correct answers
                const chosen = shuffle(goodSentences).slice(0, 2);
                // Build distractor pool from other wikis' extracts
                const distractorPool = [];
                for (const ow of otherWikis) {
                    if (ow && ow.extract) {
                        const s = pickGoodSentences(ow.extract)
                            .map(sent => {
                                // Find which capital this distractor came from
                                const otherCap = pool.find(c =>
                                    c.capital.toLowerCase() === (ow.title || '').toLowerCase()
                                );
                                return cleanSentence(sent, otherCap || { capital: ow.title || '', country: '' });
                            });
                        distractorPool.push(...s);
                    }
                }
                const uniqueDistractors = [...new Set(distractorPool)]
                    .filter(d => !d.includes(capital.capital));

                for (const sent of chosen) {
                    const correct = cleanSentence(sent, capital);
                    if (correct && uniqueDistractors.length >= 3) {
                        const dists = pickRandom(uniqueDistractors, 3);
                        // Make sure distractors don't match the correct answer
                        const filtered = dists.filter(d => d !== correct);
                        if (filtered.length >= 3) {
                            questions.push({
                                type: 'bonus-fact',
                                question: 'Which of the following is true about ' + capital.capital + '?',
                                options: shuffle([correct, ...filtered]),
                                correctAnswer: correct
                            });
                        }
                    }
                }
            }
        }

        // ── Type 3: Region ─────────────────────────────────────────
        const allRegions = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania', 'Antarctica'];
        const otherRegions = allRegions.filter(r => r !== capital.region);
        questions.push({
            type: 'bonus-region',
            question: 'In which world region is ' + capital.capital + ' located?',
            options: shuffle([capital.region, ...pickRandom(otherRegions, 3)]),
            correctAnswer: capital.region
        });

        // ── Type 4: Country (reverse) ──────────────────────────────
        const otherCountries = [...new Set(
            pool.filter(c => c.country !== capital.country).map(c => c.country)
        )];
        const countryDistractors = pickRandom(otherCountries, 3);
        questions.push({
            type: 'bonus-country',
            question: capital.capital + ' is the capital of which country or territory?',
            options: shuffle([capital.country, ...countryDistractors]),
            correctAnswer: capital.country
        });

        // ── Type 5: Hemisphere ─────────────────────────────────────
        const isNorth = capital.lat >= 0;
        questions.push({
            type: 'bonus-hemisphere',
            question: 'Is ' + capital.capital + ' located north or south of the Equator?',
            options: shuffle(['North of the Equator', 'South of the Equator']),
            correctAnswer: isNorth ? 'North of the Equator' : 'South of the Equator'
        });

        // ── Type 6: East / West of Prime Meridian ───────────────────
        const isEast = capital.lng >= 0;
        questions.push({
            type: 'bonus-meridian',
            question: 'Is ' + capital.capital + ' located east or west of the Prime Meridian?',
            options: shuffle(['East of the Prime Meridian', 'West of the Prime Meridian']),
            correctAnswer: isEast ? 'East of the Prime Meridian' : 'West of the Prime Meridian'
        });

        // ── Type 7: Status / role ───────────────────────────────────
        const otherStatuses = [...new Set(
            pool.filter(c => (c.status || 'Official') !== (capital.status || 'Official'))
                .map(c => c.status || 'Official')
        )];
        if (otherStatuses.length >= 3) {
            questions.push({
                type: 'bonus-status',
                question: 'What is the official status or role of ' + capital.capital + ' as a capital?',
                options: shuffle([capital.status || 'Official', ...pickRandom(otherStatuses, 3)]),
                correctAnswer: capital.status || 'Official'
            });
        }

        // ── Type 8: Nearest body of water ─────────────────────────
        const waterQ = generateWaterQuestion(capital, WATER_BODIES);
        if (waterQ) questions.push(waterQ);

        // Shuffle and return — the UI will serve them one at a time.
        return shuffle(questions);
    }

    // ──────────────────────────────────────────────────────────────
    //  Scoring
    // ──────────────────────────────────────────────────────────────

    /**
     * Points for the n-th correct bonus answer (0-indexed).
     * Escalating: 5, 10, 15, 20, 25, …
     */
    function bonusPointsForStreak(streakIndex) {
        return (streakIndex + 1) * 5;
    }

    /** Points for a correct main answer. */
    const MAIN_POINTS = 10;

    // ──────────────────────────────────────────────────────────────
    //  Sassy feedback messages
    // ──────────────────────────────────────────────────────────────

    const CORRECT_MAIN = [
        'Nailed it! Geography flex.',
        'Boom! You actually knew that one.',
        'Correct! Maybe you _can_ find it on a map.',
        'Yep! Your geography teacher would be proud.',
        'Spot on! The globe bows to you.'
    ];

    const WRONG_MAIN = [
        'Yikes. Bet you can\'t find _that_ on a map.',
        'Nope! The globe is disappointed in you.',
        'Wrong! Somewhere, a cartographer is crying.',
        'Oof. That\'s a map fail for the ages.',
        'Incorrect. Better luck with the next one… if you dare.'
    ];

    const CORRECT_BONUS = [
        'Bonus! You\'re on fire.',
        'Nice! The Wikipedia gods approve.',
        'Correct bonus! Show-off.',
        'Another one! Are you a walking atlas?',
        'Bonus points! Someone studied.'
    ];

    const WRONG_BONUS = [
        'And the bonus streak ends! Worth a try.',
        'Wrong bonus! Back to the globe grind.',
        'Bonus over! You gave it a shot.',
        'Incorrect — bonus round kaput.',
        'Nope! Bonus round done, but hey, points are points.'
    ];

    function randomFrom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ──────────────────────────────────────────────────────────────
    //  Public API
    // ──────────────────────────────────────────────────────────────

    return {
        // constants
        WORLD_CAPITALS,
        WATER_BODIES,
        MAIN_POINTS,
        ALL_REGIONS: ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania', 'Antarctica'],

        // utilities
        shuffle,
        pickRandom,
        pickRandomCapital,
        escapeRegex,
        splitSentences,
        cleanSentence,
        pickGoodSentences,
        bonusPointsForStreak,
        randomFrom,

        // water body utilities
        findNearestWater,

        // question generation
        generateMainQuestion,
        generateBonusQuestions,
        generateWaterQuestion,

        // Wikipedia
        fetchWikiSummary,
        _primeCache,

        // messages
        CORRECT_MAIN,
        WRONG_MAIN,
        CORRECT_BONUS,
        WRONG_BONUS
    };
}));
