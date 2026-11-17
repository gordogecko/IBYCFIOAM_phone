/**
 * celebration.js
 * A dependency-free "Atlas Rush" reward for correct answers: map-coloured
 * confetti, expanding target rings, points that fly into the score, a tiny
 * ascending chime, and (on supported phones) a short haptic tap.
 */
(function (root) {
    'use strict';

    let layer = null;
    let canvas = null;
    let effectRoot = null;
    let ctx = null;
    let audioContext = null;
    let soundEnabled = true;
    let animationFrame = null;
    let active = false;
    let celebrationCount = 0;
    let soundPlayCount = 0;
    let lastReward = null;
    let session = 0;
    let timers = [];
    const reducedMotion = () => root.matchMedia &&
        root.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const css = `
        #celebration-layer {
            position: fixed; inset: 0; z-index: 30; overflow: hidden;
            pointer-events: none; contain: layout style;
        }
        #celebration-layer canvas { position: absolute; inset: 0; }
        .atlas-shockwave {
            position: fixed; width: 70px; height: 70px; border-radius: 50%;
            border: 3px solid #fde047; transform: translate(-50%, -50%);
            box-shadow: 0 0 22px rgba(250, 204, 21, .65),
                        inset 0 0 16px rgba(34, 211, 238, .4);
            animation: atlas-shockwave .85s cubic-bezier(.1,.7,.2,1) forwards;
        }
        .atlas-shockwave.secondary {
            border-color: #22d3ee; animation-delay: .09s;
        }
        .atlas-reward-callout {
            position: fixed; transform: translate(-50%, -50%); text-align: center;
            white-space: nowrap; animation: atlas-callout 1.25s cubic-bezier(.2,.8,.2,1) forwards;
        }
        .atlas-reward-callout .reward-title {
            color: #fef08a; font-size: 12px; font-weight: 900; letter-spacing: .14em;
            text-transform: uppercase; text-shadow: 0 2px 12px #030712;
        }
        .atlas-reward-callout .reward-points {
            color: #fbbf24; font-size: 42px; font-weight: 900; line-height: 1.05;
            text-shadow: 0 0 8px rgba(251,191,36,.75), 0 4px 18px #030712;
        }
        .atlas-reward-callout .reward-caption {
            display: inline-block; margin-top: 5px; padding: 3px 10px; border-radius: 999px;
            color: #ecfeff; background: rgba(8, 47, 73, .82); border: 1px solid rgba(34,211,238,.55);
            font-size: 10px; font-weight: 800; letter-spacing: .08em;
        }
        #score-value.score-reward-hit { animation: atlas-score-hit .48s ease-out; }
        @keyframes atlas-shockwave {
            0% { opacity: .95; width: 36px; height: 36px; }
            100% { opacity: 0; width: 280px; height: 280px; border-width: 1px; }
        }
        @keyframes atlas-callout {
            0% { opacity: 0; transform: translate(-50%, -35%) scale(.55) rotate(-4deg); }
            18% { opacity: 1; transform: translate(-50%, -50%) scale(1.12) rotate(2deg); }
            35%, 72% { opacity: 1; transform: translate(-50%, -55%) scale(1) rotate(0); }
            100% { opacity: 0; transform: translate(-50%, -100%) scale(.96); }
        }
        @keyframes atlas-score-hit {
            0% { color: #fff; text-shadow: none; }
            45% { color: #fde047; transform: scale(1.65); text-shadow: 0 0 22px #facc15; }
            100% { color: #fff; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
            .atlas-shockwave { animation-duration: .01ms; }
            .atlas-reward-callout { animation: none; opacity: 1; }
        }
    `;

    function ensureElements() {
        if (layer && document.body.contains(layer)) return;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);

        layer = document.createElement('div');
        layer.id = 'celebration-layer';
        layer.setAttribute('aria-hidden', 'true');
        canvas = document.createElement('canvas');
        effectRoot = document.createElement('div');
        layer.appendChild(canvas);
        layer.appendChild(effectRoot);
        document.body.appendChild(layer);
        ctx = canvas.getContext('2d');
        resizeCanvas();
    }

    function resizeCanvas() {
        if (!canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(window.innerWidth * dpr);
        canvas.height = Math.round(window.innerHeight * dpr);
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function makeShockwaves(x, y) {
        for (let i = 0; i < 2; i++) {
            const ring = document.createElement('div');
            ring.className = 'atlas-shockwave' + (i ? ' secondary' : '');
            ring.style.left = x + 'px';
            ring.style.top = y + 'px';
            effectRoot.appendChild(ring);
        }
    }

    function makeCallout(x, y, points, bonus, streak) {
        const labels = bonus
            ? ['BONUS BLITZ', 'TRIVIA COMBO', 'BRAIN SPARK']
            : ['CAPITAL CRUSHED', 'GLOBE TROTTER', 'MAP MAGIC', 'ATLAS RUSH'];
        const callout = document.createElement('div');
        callout.className = 'atlas-reward-callout';
        callout.style.left = Math.max(100, Math.min(window.innerWidth - 100, x)) + 'px';
        callout.style.top = Math.max(90, Math.min(window.innerHeight - 150, y - 110)) + 'px';

        const title = document.createElement('div');
        title.className = 'reward-title';
        title.textContent = streak >= 3 ? 'UNSTOPPABLE x' + streak : labels[celebrationCount % labels.length];
        const score = document.createElement('div');
        score.className = 'reward-points';
        score.textContent = '+' + points;
        const caption = document.createElement('div');
        caption.className = 'reward-caption';
        caption.textContent = bonus ? 'BONUS STREAK x' + Math.max(1, streak) : 'GEOGRAPHY WIN';
        callout.appendChild(title);
        callout.appendChild(score);
        callout.appendChild(caption);
        effectRoot.appendChild(callout);
    }

    function createParticles(x, y, bonus, streak) {
        const colors = bonus
            ? ['#fbbf24', '#f472b6', '#a78bfa', '#4ade80', '#f8fafc']
            : ['#facc15', '#22d3ee', '#fb923c', '#f8fafc', '#38bdf8'];
        const count = reducedMotion() ? 10 : Math.min(80, 60 + streak * 3);
        return Array.from({ length: count }, (_, i) => {
            const angle = -Math.PI * (0.12 + Math.random() * 0.76);
            const speed = reducedMotion() ? 10 : 220 + Math.random() * 350;
            return {
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                gravity: reducedMotion() ? 0 : 580 + Math.random() * 140,
                drag: 0.985,
                spin: (Math.random() - 0.5) * 10,
                rotation: Math.random() * Math.PI * 2,
                size: 4 + Math.random() * 6,
                color: colors[i % colors.length],
                shape: ['ribbon', 'star', 'diamond', 'dot'][i % 4],
                delay: Math.random() * 80,
                life: 1000 + Math.random() * 400
            };
        });
    }

    function createTokens(origin, points) {
        const scoreEl = document.getElementById('score-value');
        const scoreRect = scoreEl ? scoreEl.getBoundingClientRect() : null;
        const target = scoreRect
            ? { x: scoreRect.left + scoreRect.width / 2, y: scoreRect.top + scoreRect.height / 2 }
            : { x: window.innerWidth / 2, y: 35 };
        return Array.from({ length: reducedMotion() ? 2 : 5 }, (_, i) => ({
            x0: origin.x, y0: origin.y,
            x1: target.x, y1: target.y,
            cx: (origin.x + target.x) / 2 + (i - 2) * 18,
            cy: Math.min(origin.y, target.y) - 80 - i * 6,
            delay: i * 55,
            duration: reducedMotion() ? 180 : 650,
            points: points
        }));
    }

    function drawStar(context, radius) {
        context.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + i * Math.PI / 5;
            const r = i % 2 ? radius * 0.43 : radius;
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r;
            if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.closePath();
        context.fill();
    }

    function drawParticle(p, age) {
        if (age < p.delay || age > p.life) return;
        const t = (age - p.delay) / 1000;
        const x = p.x + p.vx * t * Math.pow(p.drag, t * 60);
        const y = p.y + p.vy * t + p.gravity * t * t / 2;
        const alpha = Math.max(0, Math.min(1, (p.life - age) / 300));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(p.rotation + p.spin * t);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        if (p.shape === 'star') {
            drawStar(ctx, p.size);
        } else if (p.shape === 'ribbon') {
            ctx.scale(Math.cos(t * 15), 1);
            ctx.fillRect(-p.size * 0.35, -p.size, p.size * 0.7, p.size * 2);
        } else if (p.shape === 'dot') {
            ctx.beginPath(); ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2); ctx.fill();
        } else {
            ctx.rotate(Math.PI / 4); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        }
        ctx.restore();
    }

    function drawToken(token, age) {
        const t = (age - token.delay) / token.duration;
        if (t < 0 || t > 1) return;
        const u = 1 - Math.pow(1 - t, 2);
        const inv = 1 - u;
        const x = inv * inv * token.x0 + 2 * inv * u * token.cx + u * u * token.x1;
        const y = inv * inv * token.y0 + 2 * inv * u * token.cy + u * u * token.y1;
        const radius = 9 + Math.min(t, 0.3) * 11 - Math.max(0, t - 0.8) * 18;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - t) * 5 + 0.25);
        ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 15;
        ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(x, y, Math.max(4, radius), 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#78350f';
        ctx.font = '900 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('★', x, y + 1);
        ctx.restore();
    }

    function playChime(bonus, streak) {
        if (!soundEnabled) return;
        const AudioCtor = root.AudioContext || root.webkitAudioContext;
        if (!AudioCtor) return;
        try {
            if (!audioContext) audioContext = new AudioCtor();
            if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
            const base = audioContext.currentTime + 0.015;
            const notes = bonus ? [659.25, 783.99, 987.77, 1318.51] : [523.25, 659.25, 783.99, 1046.5];
            notes.forEach((frequency, i) => {
                const start = base + i * 0.06;
                const oscillator = audioContext.createOscillator();
                const gain = audioContext.createGain();
                oscillator.type = i === notes.length - 1 ? 'triangle' : 'sine';
                oscillator.frequency.setValueAtTime(frequency * (1 + Math.min(streak, 5) * 0.008), start);
                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.exponentialRampToValueAtTime(i === notes.length - 1 ? 0.12 : 0.08, start + 0.012);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + (i === notes.length - 1 ? 0.38 : 0.18));
                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                oscillator.start(start);
                oscillator.stop(start + 0.4);
            });
            soundPlayCount++;
        } catch (e) {
            // Visual rewards must still work when audio is unavailable.
        }
    }

    function celebrate(options) {
        const opts = options || {};
        cancel();
        ensureElements();
        resizeCanvas();
        celebrationCount++;
        const originEl = opts.originElement;
        const rect = originEl && originEl.getBoundingClientRect
            ? originEl.getBoundingClientRect()
            : { left: window.innerWidth / 2 - 1, top: window.innerHeight / 2 - 1, width: 2, height: 2 };
        const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const points = Math.max(0, Number(opts.points) || 0);
        const streak = Math.max(1, Number(opts.streak) || 1);
        const bonus = !!opts.bonus;
        const particles = createParticles(origin.x, origin.y, bonus, streak);
        const tokens = createTokens(origin, points);
        const started = performance.now();
        const thisSession = session;
        active = true;
        lastReward = { points: points, bonus: bonus, streak: streak, startedAt: started };
        makeShockwaves(origin.x, origin.y);
        makeCallout(origin.x, origin.y, points, bonus, streak);
        playChime(bonus, streak);
        if (!reducedMotion() && navigator.vibrate) navigator.vibrate([15, 30, 22]);

        timers.push(setTimeout(() => {
            const scoreEl = document.getElementById('score-value');
            if (scoreEl) {
                scoreEl.classList.remove('score-reward-hit');
                void scoreEl.offsetWidth;
                scoreEl.classList.add('score-reward-hit');
            }
        }, reducedMotion() ? 80 : 550));

        function frame(now) {
            if (thisSession !== session) return;
            const age = now - started;
            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            particles.forEach(p => drawParticle(p, age));
            tokens.forEach(t => drawToken(t, age));
            if (age < 1500) {
                animationFrame = requestAnimationFrame(frame);
            } else {
                active = false;
                animationFrame = null;
                ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            }
        }
        animationFrame = requestAnimationFrame(frame);
    }

    function cancel() {
        session++;
        if (animationFrame) cancelAnimationFrame(animationFrame);
        animationFrame = null;
        active = false;
        timers.forEach(clearTimeout);
        timers = [];
        if (effectRoot) effectRoot.innerHTML = '';
        if (ctx && canvas) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }

    function setSoundEnabled(enabled) {
        soundEnabled = !!enabled;
        return soundEnabled;
    }

    root.Celebration = {
        celebrate: celebrate,
        cancel: cancel,
        setSoundEnabled: setSoundEnabled,
        toggleSound: function () { return setSoundEnabled(!soundEnabled); },
        getState: function () {
            return {
                active: active,
                celebrationCount: celebrationCount,
                soundPlayCount: soundPlayCount,
                soundEnabled: soundEnabled,
                lastReward: lastReward,
                effectCount: effectRoot ? effectRoot.childElementCount : 0,
                canvasParticlesFresh: !!(canvas && canvas.width > 0)
            };
        }
    };
}(typeof self !== 'undefined' ? self : this));
