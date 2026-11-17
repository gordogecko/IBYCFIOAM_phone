/**
 * globe.js
 * ------------------------------------------------------------------
 * 3D Earth globe renderer for "I Bet You Can't Find It On A Map."
 * MOBILE-OPTIMIZED VERSION for smartphone portrait mode.
 *
 * Uses Three.js (r128), D3, and TopoJSON loaded from CDN in index.html.
 *
 * Public API (window.Globe):
 *   init()                       – build the scene, globe, borders, stars
 *   populateMarkers(capitals)    – place pin markers on the globe
 *   flyTo(item)                  – gently glide to a capital (legacy API)
 *   spinTo(item, onComplete)     – slot-machine spin to a new question
 *   previewCapital(item)         – cyan focus without revealing its name
 *   highlightCapital(item)       – enlarge + recolour the answered pin
 *   clearHighlight()             – reset all pins to default
 *   pulseCapital(item, color)    – brief colour flash on a pin
 *   cancelMotion()               – stop any pending camera animation
 *   setAutoRotate(enabled)       – toggle globe auto-rotation
 *   onReady(callback)           – call back once textures are loaded
 *   isReady()                    – true once globe textures are loaded
 * ------------------------------------------------------------------
 */
(function (root) {
    'use strict';

    const GLOBE_RADIUS = 5;
    let scene, camera, renderer, controls;
    let globeMesh, bordersMesh, atmosphereMesh;
    let satelliteTexture, bumpTexture, specularTexture;
    let capitalMarkersGroup = new THREE.Group();
    let capitalObjects = [];
    let isGlobeReady = false;
    let readyCallbacks = [];
    let autoRotateEnabled = true;
    let focusedObject = null;
    let focusedMode = null;
    let targetItem = null;
    let cameraMotion = null;
    let spinState = 'idle';
    let lastSpin = null;

    // ── Coordinate helper ──────────────────────────────────────────
    function latLngToVector3(lat, lng, radius) {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lng + 180) * (Math.PI / 180);
        const x = -(radius * Math.sin(phi) * Math.cos(theta));
        const z = (radius * Math.sin(phi) * Math.sin(theta));
        const y = (radius * Math.cos(phi));
        return new THREE.Vector3(x, y, z);
    }

    // ── Scene setup ────────────────────────────────────────────────
    function init() {
        const container = document.getElementById('globe-container');

        scene = new THREE.Scene();

        // Mobile-optimized: narrower FOV for portrait mode
        const aspect = window.innerWidth / window.innerHeight;
        camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
        // Position camera closer for mobile portrait view
        camera.position.set(0, 1, 12);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        container.appendChild(renderer.domElement);

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.rotateSpeed = 0.5;  // Slightly slower for mobile
        controls.zoomSpeed = 0.8;
        controls.minDistance = 6.5;  // Closer minimum for mobile
        controls.maxDistance = 20;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.3;
        // Touch-friendly settings
        controls.enablePan = false;  // Disable pan for simpler mobile interaction
        controls.touches = {
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_ROTATE
        };

        const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.88);
        scene.add(ambientLight);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1.3);
        sunLight.position.set(14, 8, 12);
        scene.add(sunLight);

        const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
        rimLight.position.set(-14, -6, -12);
        scene.add(rimLight);

        createStarfield();
        scene.add(capitalMarkersGroup);

        window.addEventListener('resize', onWindowResize, false);

        buildGlobe();
        animate();
    }

    function createStarfield() {
        const starsGeo = new THREE.BufferGeometry();
        const count = 1500;  // Fewer stars for mobile performance
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count * 3; i += 3) {
            const radius = 120 + Math.random() * 130;
            const u = Math.random();
            const v = Math.random();
            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);
            positions[i] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i + 2] = radius * Math.cos(phi);
        }
        starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const starsMat = new THREE.PointsMaterial({
            color: 0xcbd5e1,
            size: 1.5,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.7
        });
        scene.add(new THREE.Points(starsGeo, starsMat));
    }

    // ── Asset URL configuration ────────────────────────────────────
    const ASSETS = Object.assign({
        satTexture:  'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
        bumpTexture: 'https://unpkg.com/three-globe/example/img/earth-topology.png',
        waterTexture:'https://unpkg.com/three-globe/example/img/earth-water.png',
        bordersGeo:  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json'
    }, (typeof root !== 'undefined' && root.GLOBE_ASSETS) || {});

    // ── Globe mesh, borders, atmosphere ────────────────────────────
    function buildGlobe() {
        const textureLoader = new THREE.TextureLoader();
        textureLoader.setCrossOrigin('anonymous');

        const satUrl = ASSETS.satTexture;
        const bumpUrl = ASSETS.bumpTexture;
        const waterUrl = ASSETS.waterTexture;

        let loadedCount = 0;
        const totalNeeded = 2;
        const markLoaded = () => {
            loadedCount++;
            if (loadedCount >= totalNeeded) {
                isGlobeReady = true;
                readyCallbacks.forEach(cb => cb());
            }
        };

        satelliteTexture = textureLoader.load(satUrl, markLoaded, undefined, markLoaded);
        bumpTexture = textureLoader.load(bumpUrl);
        specularTexture = textureLoader.load(waterUrl);

        const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);  // Slightly fewer segments for mobile
        const globeMat = new THREE.MeshPhongMaterial({
            map: satelliteTexture,
            bumpMap: bumpTexture,
            bumpScale: 0.06,
            specularMap: specularTexture,
            specular: new THREE.Color(0x334155),
            shininess: 18
        });
        globeMesh = new THREE.Mesh(sphereGeo, globeMat);
        scene.add(globeMesh);

        // Atmosphere
        const atmosGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.028, 48, 48);
        const atmosMat = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: `
                varying vec3 vNormal;
                void main() {
                    float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
                    gl_FragColor = vec4(0.25, 0.65, 1.0, 1.0) * intensity * 1.1;
                }`,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            transparent: true
        });
        atmosphereMesh = new THREE.Mesh(atmosGeo, atmosMat);
        scene.add(atmosphereMesh);

        // Borders overlay
        const borderCanvas = document.createElement('canvas');
        borderCanvas.width = 2048;  // Lower resolution for mobile
        borderCanvas.height = 1024;
        const bCtx = borderCanvas.getContext('2d');

        const borderTexture = new THREE.CanvasTexture(borderCanvas);
        borderTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

        const bordersGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.002, 64, 64);
        const bordersMat = new THREE.MeshBasicMaterial({
            map: borderTexture,
            transparent: true,
            depthWrite: false
        });
        bordersMesh = new THREE.Mesh(bordersGeo, bordersMat);
        scene.add(bordersMesh);

        d3.json(ASSETS.bordersGeo).then(data => {
            const countries = topojson.feature(data, data.objects.countries);
            const projection = d3.geoEquirectangular()
                .translate([borderCanvas.width / 2, borderCanvas.height / 2])
                .scale(borderCanvas.width / (2 * Math.PI));
            const path = d3.geoPath().projection(projection).context(bCtx);

            bCtx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
            bCtx.lineWidth = 2.5;
            bCtx.beginPath();
            path(countries);
            bCtx.stroke();

            bCtx.strokeStyle = 'rgba(253, 224, 71, 0.85)';
            bCtx.lineWidth = 1.2;
            bCtx.beginPath();
            path(countries);
            bCtx.stroke();

            borderTexture.needsUpdate = true;
            markLoaded();
        }).catch(err => {
            console.warn('Could not load TopoJSON borders.', err);
            markLoaded();
        });
    }

    // ── Capital markers ────────────────────────────────────────────
    function populateMarkers(capitalsList) {
        capitalObjects.forEach(obj => capitalMarkersGroup.remove(obj.mesh));
        capitalObjects = [];

        const markerGeo = new THREE.SphereGeometry(0.055, 12, 12);  // Slightly larger for mobile
        const ringGeo = new THREE.RingGeometry(0.072, 0.108, 16);
        const haloGeo = new THREE.RingGeometry(0.13, 0.15, 28);

        capitalsList.forEach(item => {
            const pos = latLngToVector3(item.lat, item.lng, GLOBE_RADIUS + 0.028);
            const markerMesh = new THREE.Group();
            markerMesh.position.copy(pos);

            const isOfficial = !item.status || item.status.startsWith('Official');
            const pinColor = isOfficial ? 0xef4444 : 0x38bdf8;

            const sphereMat = new THREE.MeshBasicMaterial({ color: pinColor });
            const dot = new THREE.Mesh(markerGeo, sphereMat);
            markerMesh.add(dot);

            const ringMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.8
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.lookAt(pos.clone().multiplyScalar(2));
            markerMesh.add(ring);

            const haloMat = new THREE.MeshBasicMaterial({
                color: 0x22d3ee,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0,
                depthWrite: false
            });
            const halo = new THREE.Mesh(haloGeo, haloMat);
            halo.lookAt(pos.clone().multiplyScalar(2));
            halo.visible = false;
            markerMesh.add(halo);

            markerMesh.userData = Object.assign({}, item, { baseColor: pinColor });
            capitalMarkersGroup.add(markerMesh);
            capitalObjects.push({
                mesh: markerMesh,
                data: item,
                dotMesh: dot,
                ringMesh: ring,
                haloMesh: halo,
                baseColor: pinColor
            });
        });
    }

    // ── Highlight / pulse a capital ─────────────────────────────────
    function focusCapital(item, revealed) {
        clearHighlight();
        capitalObjects.forEach(obj => {
            if (obj.data.capital === item.capital && obj.data.country === item.country) {
                const color = revealed ? 0xfacc15 : 0x22d3ee;
                focusedObject = obj;
                focusedMode = revealed ? 'revealed' : 'preview';
                obj.dotMesh.scale.set(2.5, 2.5, 2.5);
                obj.dotMesh.material.color.setHex(color);
                obj.ringMesh.material.color.setHex(color);
                obj.ringMesh.material.opacity = 1;
                obj.haloMesh.material.color.setHex(color);
                obj.haloMesh.visible = true;
            }
        });
    }

    function previewCapital(item) {
        focusCapital(item, false);
    }

    function highlightCapital(item) {
        focusCapital(item, true);
    }

    function clearHighlight() {
        focusedObject = null;
        focusedMode = null;
        targetItem = null;
        capitalObjects.forEach(obj => {
            obj.dotMesh.scale.set(1, 1, 1);
            obj.dotMesh.material.color.setHex(obj.baseColor);
            obj.ringMesh.material.color.setHex(0xffffff);
            obj.ringMesh.material.opacity = 0.8;
            if (obj.haloMesh) obj.haloMesh.visible = false;
        });
    }

    function pulseCapital(item, hexColor) {
        capitalObjects.forEach(obj => {
            if (obj.data.capital === item.capital && obj.data.country === item.country) {
                const start = performance.now();
                const dur = 800;
                const baseScale = 2.5;
                const animatePulse = function (now) {
                    const t = (now - start) / dur;
                    if (t >= 1) {
                        obj.dotMesh.scale.set(baseScale, baseScale, baseScale);
                        obj.dotMesh.material.color.setHex(hexColor);
                        return;
                    }
                    const s = baseScale + Math.sin(t * Math.PI * 3) * 0.8 * (1 - t);
                    obj.dotMesh.scale.set(s, s, s);
                    obj.dotMesh.material.color.setHex(hexColor);
                    requestAnimationFrame(animatePulse);
                };
                requestAnimationFrame(animatePulse);
            }
        });
    }

    // ── Camera motion / slot-machine spin ───────────────────────────
    function startCameraMotion(item, onComplete, options) {
        if (!camera || !controls) return;
        const opts = options || {};
        const reducedMotion = root.matchMedia &&
            root.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const isSpin = !!opts.spin && !reducedMotion;

        autoRotateEnabled = false;
        controls.autoRotate = false;
        controls.enabled = false;

        const savedDamping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();

        const startSpherical = new THREE.Spherical().setFromVector3(camera.position);
        const targetPos = latLngToVector3(item.lat, item.lng, opts.radius || 9.5);  // Closer for mobile
        const endSpherical = new THREE.Spherical().setFromVector3(targetPos);
        endSpherical.phi = Math.max(0.015, Math.min(Math.PI - 0.015, endSpherical.phi));

        const twoPi = Math.PI * 2;
        const signedDelta = Math.atan2(
            Math.sin(endSpherical.theta - startSpherical.theta),
            Math.cos(endSpherical.theta - startSpherical.theta)
        );
        const fullTurns = isSpin ? 2 : 0;
        const angularDelta = isSpin
            ? ((signedDelta % twoPi) + twoPi) % twoPi + fullTurns * twoPi
            : signedDelta;

        targetItem = item;
        cameraMotion = {
            type: isSpin ? 'spin' : 'fly',
            startTime: performance.now(),
            duration: reducedMotion ? 450 : (opts.duration || (isSpin ? 2400 : 700)),  // Faster for mobile
            startTheta: startSpherical.theta,
            deltaTheta: angularDelta,
            startPhi: startSpherical.phi,
            endPhi: endSpherical.phi,
            startRadius: startSpherical.radius,
            endRadius: endSpherical.radius,
            targetPos: targetPos,
            item: item,
            fullTurns: fullTurns,
            savedDamping: savedDamping,
            onComplete: onComplete
        };
        setSpinState(isSpin ? 'winding-up' : 'flying');
    }

    function setSpinState(value) {
        spinState = value;
        const container = document.getElementById('globe-container');
        if (container) container.dataset.spinState = value;
    }

    function spinTo(item, onComplete) {
        startCameraMotion(item, onComplete, { spin: true, duration: 2400 });
    }

    function flyTo(item, onComplete) {
        startCameraMotion(item, onComplete, { spin: false, duration: 700 });
    }

    function cancelMotion() {
        if (cameraMotion && controls) {
            controls.enabled = true;
            controls.enableDamping = cameraMotion.savedDamping;
            controls.autoRotate = autoRotateEnabled;
        }
        cameraMotion = null;
        targetItem = null;
        setSpinState('idle');
    }

    function easeInOutQuintic(t) {
        return t < 0.5
            ? 16 * t * t * t * t * t
            : 1 - Math.pow(-2 * t + 2, 5) / 2;
    }

    function updateCameraMotion(now) {
        if (!cameraMotion) return;
        const motion = cameraMotion;
        const progress = Math.min((now - motion.startTime) / motion.duration, 1);
        const eased = motion.type === 'spin'
            ? easeInOutQuintic(progress)
            : 1 - Math.pow(1 - progress, 3);

        const spherical = new THREE.Spherical(
            THREE.MathUtils.lerp(motion.startRadius, motion.endRadius, eased),
            THREE.MathUtils.lerp(motion.startPhi, motion.endPhi, eased),
            motion.startTheta + motion.deltaTheta * eased
        );
        camera.position.setFromSpherical(spherical);
        camera.lookAt(0, 0, 0);

        if (motion.type === 'spin') {
            if (progress >= 0.82) setSpinState('landing');
            else if (progress >= 0.07) setSpinState('spinning');
        }

        if (progress >= 1) {
            camera.position.copy(motion.targetPos);
            camera.lookAt(0, 0, 0);
            controls.enabled = true;
            controls.enableDamping = motion.savedDamping;
            controls.autoRotate = autoRotateEnabled;
            controls.update();

            if (motion.type === 'spin') {
                lastSpin = {
                    turns: Math.abs(motion.deltaTheta) / (Math.PI * 2),
                    duration: motion.duration,
                    capital: motion.item.capital,
                    country: motion.item.country,
                    completedAt: now
                };
                setSpinState('settled');
            } else {
                setSpinState('idle');
            }
            cameraMotion = null;
            if (typeof motion.onComplete === 'function') motion.onComplete();
        }
    }

    function getDebugState() {
        let target = null;
        if (targetItem && camera) {
            const worldPos = latLngToVector3(targetItem.lat, targetItem.lng, GLOBE_RADIUS + 0.028);
            const facing = worldPos.clone().normalize().dot(camera.position.clone().normalize());
            const projected = worldPos.clone().project(camera);
            target = {
                capital: targetItem.capital,
                country: targetItem.country,
                facing: facing,
                x: (projected.x + 1) * window.innerWidth / 2,
                y: (1 - projected.y) * window.innerHeight / 2,
                onFront: facing > 0,
                inViewport: projected.z > -1 && projected.z < 1 &&
                    Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1,
                markerMode: focusedMode
            };
        }
        return {
            spinState: spinState,
            autoRotate: autoRotateEnabled,
            cameraAzimuth: camera ? new THREE.Spherical().setFromVector3(camera.position).theta : null,
            progress: cameraMotion
                ? Math.min((performance.now() - cameraMotion.startTime) / cameraMotion.duration, 1)
                : null,
            plannedTurns: cameraMotion
                ? Math.abs(cameraMotion.deltaTheta) / (Math.PI * 2)
                : null,
            target: target,
            lastSpin: lastSpin
        };
    }

    // ── Auto-rotation ───────────────────────────────────────────────
    function setAutoRotate(enabled) {
        autoRotateEnabled = enabled;
        controls.autoRotate = enabled && !cameraMotion;
    }

    function getAutoRotate() {
        return autoRotateEnabled;
    }

    // ── Resize ──────────────────────────────────────────────────────
    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ── Animation loop ──────────────────────────────────────────────
    function animate(now) {
        requestAnimationFrame(animate);
        updateCameraMotion(now || performance.now());
        const time = Date.now() * 0.003;
        capitalObjects.forEach(obj => {
            const s = 1 + Math.sin(time + obj.data.lat) * 0.25;
            obj.ringMesh.scale.set(s, s, s);
        });
        if (focusedObject && focusedObject.haloMesh) {
            const phase = (time * 0.42) % 1;
            const haloScale = 1 + phase * 2.7;
            focusedObject.haloMesh.scale.set(haloScale, haloScale, haloScale);
            focusedObject.haloMesh.material.opacity = 0.9 * (1 - phase);
            focusedObject.ringMesh.scale.set(1.65, 1.65, 1.65);
        }
        controls.update();
        renderer.render(scene, camera);
    }

    // ── Ready callbacks ─────────────────────────────────────────────
    function onReady(cb) {
        if (isGlobeReady) cb();
        else readyCallbacks.push(cb);
    }

    function isReady() {
        return isGlobeReady;
    }

    // ── Public API ──────────────────────────────────────────────────
    root.Globe = {
        init: init,
        populateMarkers: populateMarkers,
        flyTo: flyTo,
        spinTo: spinTo,
        previewCapital: previewCapital,
        highlightCapital: highlightCapital,
        clearHighlight: clearHighlight,
        pulseCapital: pulseCapital,
        cancelMotion: cancelMotion,
        setAutoRotate: setAutoRotate,
        getAutoRotate: getAutoRotate,
        getDebugState: getDebugState,
        onReady: onReady,
        isReady: isReady,
        getCapitalCount: function () { return capitalObjects.length; }
    };

})(typeof self !== 'undefined' ? self : this);
