/**
 * water_bodies.js
 * ------------------------------------------------------------------
 * Dataset of major world bodies of water for the "nearest body of
 * water" bonus question in "I Bet You Can't Find It On A Map."
 *
 * Each entry has:
 *   name : string  — the body of water's name
 *   type : string  — ocean | sea | gulf | bay | strait | channel | lake
 *   lat  : number  — approximate center latitude
 *   lng  : number  — approximate center longitude
 *
 * Large oceans have multiple center points (same name) so the
 * Haversine lookup can match the nearest coastline region.
 *
 * Exported (browser global + CommonJS):
 *   WATER_BODIES        — array of { name, type, lat, lng }
 *   findNearestWater    — (lat, lng, list?) → sorted [{ name, type, dist }]
 *   haversine           — (lat1, lng1, lat2, lng2) → km
 * ------------------------------------------------------------------
 */
(function (root) {
    'use strict';

    const WATER_BODIES = [
        // ── Oceans (multiple centers for the huge ones) ──────────
        { name: "Pacific Ocean",        type: "ocean",   lat: 35,   lng: -130 },
        { name: "Pacific Ocean",        type: "ocean",   lat: -15,  lng: -85  },
        { name: "Pacific Ocean",        type: "ocean",   lat: 30,   lng: 155  },
        { name: "Pacific Ocean",        type: "ocean",   lat: -20,  lng: 175  },
        { name: "Atlantic Ocean",       type: "ocean",   lat: 40,   lng: -40  },
        { name: "Atlantic Ocean",       type: "ocean",   lat: -15,  lng: -15  },
        { name: "Atlantic Ocean",       type: "ocean",   lat: 25,   lng: -30  },
        { name: "Indian Ocean",         type: "ocean",   lat: 5,    lng: 70   },
        { name: "Indian Ocean",         type: "ocean",   lat: -30,  lng: 80   },
        { name: "Arctic Ocean",         type: "ocean",   lat: 82,   lng: 0    },
        { name: "Arctic Ocean",         type: "ocean",   lat: 82,   lng: 180  },
        { name: "Southern Ocean",       type: "ocean",   lat: -65,  lng: 0    },
        { name: "Southern Ocean",       type: "ocean",   lat: -65,  lng: 180  },

        // ── Mediterranean & European seas ────────────────────────
        { name: "Mediterranean Sea",    type: "sea",     lat: 35,   lng: 18   },
        { name: "Adriatic Sea",         type: "sea",     lat: 42,   lng: 16   },
        { name: "Aegean Sea",           type: "sea",     lat: 38,   lng: 25   },
        { name: "Ionian Sea",           type: "sea",     lat: 38,   lng: 18   },
        { name: "Tyrrhenian Sea",       type: "sea",     lat: 40,   lng: 12   },
        { name: "Ligurian Sea",         type: "sea",     lat: 43.5, lng: 9    },
        { name: "Balearic Sea",         type: "sea",     lat: 39,   lng: 1    },
        { name: "Alboran Sea",          type: "sea",     lat: 36,   lng: -3   },
        { name: "Black Sea",            type: "sea",     lat: 43,   lng: 35   },
        { name: "Sea of Azov",          type: "sea",     lat: 46.5, lng: 37   },
        { name: "Sea of Marmara",       type: "sea",     lat: 40.5, lng: 28   },
        { name: "Baltic Sea",           type: "sea",     lat: 58,   lng: 20   },
        { name: "North Sea",            type: "sea",     lat: 57,   lng: 3    },
        { name: "Norwegian Sea",        type: "sea",     lat: 67,   lng: 5    },
        { name: "Barents Sea",          type: "sea",     lat: 73,   lng: 35   },
        { name: "Irish Sea",            type: "sea",     lat: 53.5, lng: -5   },
        { name: "Celtic Sea",           type: "sea",     lat: 50,   lng: -8   },
        { name: "Caspian Sea",          type: "sea",     lat: 41,   lng: 50   },

        // ── Asian seas ───────────────────────────────────────────
        { name: "South China Sea",      type: "sea",     lat: 15,   lng: 115  },
        { name: "East China Sea",       type: "sea",     lat: 30,   lng: 125  },
        { name: "Yellow Sea",           type: "sea",     lat: 36,   lng: 123  },
        { name: "Sea of Japan",         type: "sea",     lat: 40,   lng: 135  },
        { name: "Sea of Okhotsk",       type: "sea",     lat: 55,   lng: 145  },
        { name: "Philippine Sea",       type: "sea",     lat: 15,   lng: 135  },
        { name: "Sulu Sea",             type: "sea",     lat: 9,    lng: 120  },
        { name: "Celebes Sea",          type: "sea",     lat: 4,    lng: 120  },
        { name: "Java Sea",             type: "sea",     lat: -5,   lng: 110  },
        { name: "Banda Sea",            type: "sea",     lat: -5,   lng: 128  },
        { name: "Arafura Sea",           type: "sea",     lat: -8,   lng: 135  },
        { name: "Timor Sea",            type: "sea",     lat: -10,  lng: 127  },
        { name: "Andaman Sea",          type: "sea",     lat: 12,   lng: 95   },
        { name: "Bering Sea",           type: "sea",     lat: 58,   lng: -175 },
        { name: "Kara Sea",             type: "sea",     lat: 75,   lng: 75   },
        { name: "Laptev Sea",           type: "sea",     lat: 76,   lng: 130  },
        { name: "East Siberian Sea",     type: "sea",     lat: 73,   lng: 160  },
        { name: "Chukchi Sea",          type: "sea",     lat: 70,   lng: -170 },
        { name: "Beaufort Sea",         type: "sea",     lat: 72,   lng: -140 },
        { name: "Aral Sea",             type: "sea",     lat: 45,   lng: 60   },

        // ── Americas seas ────────────────────────────────────────
        { name: "Caribbean Sea",        type: "sea",     lat: 15,   lng: -75  },
        { name: "Labrador Sea",         type: "sea",     lat: 58,   lng: -55  },
        { name: "Greenland Sea",        type: "sea",     lat: 75,   lng: -10  },
        { name: "Baffin Bay",           type: "sea",     lat: 70,   lng: -65  },
        { name: "Sargasso Sea",         type: "sea",     lat: 28,   lng: -50  },

        // ── African seas & channels ─────────────────────────────
        { name: "Red Sea",              type: "sea",     lat: 20,   lng: 38   },
        { name: "Mozambique Channel",   type: "channel", lat: -18,  lng: 43   },

        // ── Gulfs ────────────────────────────────────────────────
        { name: "Persian Gulf",         type: "gulf",    lat: 26,   lng: 51   },
        { name: "Gulf of Mexico",       type: "gulf",    lat: 25,   lng: -90  },
        { name: "Gulf of Guinea",       type: "gulf",    lat: 3,    lng: 0    },
        { name: "Gulf of Aden",         type: "gulf",    lat: 12,   lng: 47   },
        { name: "Gulf of Oman",         type: "gulf",    lat: 24,   lng: 58   },
        { name: "Gulf of Thailand",     type: "gulf",    lat: 10,   lng: 100  },
        { name: "Gulf of Finland",      type: "gulf",    lat: 60,   lng: 27   },
        { name: "Gulf of Bothnia",      type: "gulf",    lat: 62,   lng: 20   },
        { name: "Gulf of California",   type: "gulf",    lat: 27,   lng: -111 },
        { name: "Gulf of Alaska",       type: "gulf",    lat: 59,   lng: -147 },
        { name: "Gulf of Carpentaria",  type: "gulf",    lat: -14,  lng: 139  },
        { name: "Gulf of Panama",       type: "gulf",    lat: 7,    lng: -80  },
        { name: "Gulf of Tonkin",       type: "gulf",    lat: 20,   lng: 107  },

        // ── Bays ─────────────────────────────────────────────────
        { name: "Bay of Bengal",        type: "bay",     lat: 15,   lng: 88   },
        { name: "Bay of Biscay",        type: "bay",     lat: 45,   lng: -4   },
        { name: "Hudson Bay",           type: "bay",     lat: 60,   lng: -82  },
        { name: "Great Australian Bight", type: "bay",  lat: -32,  lng: 130  },
        { name: "Bay of Fundy",         type: "bay",     lat: 45,   lng: -66  },

        // ── Straits / Channels ──────────────────────────────────
        { name: "Strait of Gibraltar",  type: "strait",  lat: 35.9, lng: -5.5 },
        { name: "Strait of Malacca",    type: "strait",  lat: 3,    lng: 100  },
        { name: "English Channel",      type: "channel", lat: 50,   lng: -2   },
        { name: "Bosphorus Strait",     type: "strait",  lat: 41,   lng: 29   },
        { name: "Taiwan Strait",        type: "strait",  lat: 24,   lng: 119  },
        { name: "Strait of Hormuz",     type: "strait",  lat: 26.5, lng: 56.5 },
        { name: "Bab-el-Mandeb Strait", type: "strait",  lat: 12.5, lng: 43.5 },
        { name: "Davis Strait",         type: "strait",  lat: 64,   lng: -55  },
        { name: "Denmark Strait",       type: "strait",  lat: 66,   lng: -26  },

        // ── Major Lakes ──────────────────────────────────────────
        { name: "Lake Victoria",        type: "lake",    lat: -1,   lng: 33   },
        { name: "Lake Tanganyika",      type: "lake",    lat: -6,   lng: 29.5 },
        { name: "Lake Baikal",          type: "lake",    lat: 53,   lng: 108  },
        { name: "Lake Superior",        type: "lake",    lat: 47,   lng: -88  },
        { name: "Lake Michigan",        type: "lake",    lat: 44,   lng: -87  },
        { name: "Lake Huron",           type: "lake",    lat: 44.5, lng: -82  },
        { name: "Lake Erie",            type: "lake",    lat: 42,   lng: -81  },
        { name: "Lake Ontario",         type: "lake",    lat: 43.5, lng: -77  },
        { name: "Lake Chad",            type: "lake",    lat: 13,   lng: 14   },
        { name: "Lake Malawi",          type: "lake",    lat: -12,  lng: 34.5 },
        { name: "Dead Sea",             type: "lake",    lat: 31.5, lng: 35.5 },
        { name: "Lake Geneva",          type: "lake",    lat: 46.4, lng: 6.5  },
        { name: "Great Slave Lake",     type: "lake",    lat: 61.5, lng: -114 },
        { name: "Great Bear Lake",      type: "lake",    lat: 66,   lng: -121 },
        { name: "Lake Winnipeg",        type: "lake",    lat: 53,   lng: -97  },
        { name: "Lake Balkhash",        type: "lake",    lat: 46,   lng: 79   }
    ];

    // ── Haversine distance (km) ──────────────────────────────────
    function haversine(lat1, lng1, lat2, lng2) {
        const R = 6371; // Earth radius in km
        const toRad = function (d) { return d * Math.PI / 180; };
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        // Normalise longitude difference to handle ±180° wrap
        const dLngN = Math.atan2(Math.sin(dLng), Math.cos(dLng));
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                  Math.sin(dLngN / 2) * Math.sin(dLngN / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // ── Find nearest water bodies ────────────────────────────────
    // Returns an array of { name, type, dist } sorted by distance.
    // Entries sharing a name (e.g. multiple Pacific Ocean centres)
    // are deduplicated — only the nearest centre for each name wins.
    function findNearestWater(lat, lng, list) {
        const wbs = list || WATER_BODIES;
        const byName = new Map();
        for (let i = 0; i < wbs.length; i++) {
            const wb = wbs[i];
            const dist = haversine(lat, lng, wb.lat, wb.lng);
            if (!byName.has(wb.name) || dist < byName.get(wb.name).dist) {
                byName.set(wb.name, { name: wb.name, type: wb.type, dist: dist });
            }
        }
        const arr = [];
        byName.forEach(function (v) { arr.push(v); });
        arr.sort(function (a, b) { return a.dist - b.dist; });
        return arr;
    }

    // ── Exports ──────────────────────────────────────────────────
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { WATER_BODIES, haversine, findNearestWater };
    }
    if (typeof window !== 'undefined') {
        window.WATER_BODIES = WATER_BODIES;
        window.haversine = haversine;
        window.findNearestWater = findNearestWater;
    }
})(typeof self !== 'undefined' ? self : this);
