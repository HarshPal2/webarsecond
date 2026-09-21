import * as THREE from 'three';
import { MindARThree } from 'mind-ar/src/image-target/three.js';

// Ensure THREE is globally accessible for MindAR internal utilities if required
if (typeof window !== 'undefined' && !window.THREE) {
  window.THREE = THREE;
}

// =========================================================================
// CARD & VIDEO TRANSFORM CONFIGURATION
// Configurable constants for AR video plane sizing and offsets.
// =========================================================================
export const CARD_WIDTH = 1.0;          // Physical card relative width reference
export const CARD_HEIGHT = 1.4;         // Physical card relative height reference
export const CARD_Z_OFFSET = 0.005;     // Card surface Z offset

// Video Transform Parameters
export const ENABLE_VIDEO = true;       // Set to false to temporarily bypass video setup for diagnostic isolation
export const VIDEO_PATH = '/videos/Video_1.mp4';
export const VIDEO_WIDTH = 1.5;         // Configurable video plane width in AR units
export const VIDEO_OFFSET_X = 0;        // Horizontal offset relative to target center
export const VIDEO_OFFSET_Y = 0;        // Vertical offset relative to target center
export const VIDEO_OFFSET_Z = 0.01;     // Elevation above card surface to prevent z-fighting

// Spatial Audio Parameters
export const ENABLE_SPATIAL_AUDIO = true;
export const MIN_AUDIO_DIST = 0.4;      // Full volume threshold (AR tracking distance)
export const MAX_AUDIO_DIST = 2.5;      // Silent threshold (AR tracking distance)

// Debug Options
export const SHOW_ALIGNMENT_DEBUG = false; // Set to true to display Phase 1 green debug plane

export class CardAR {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Container element for camera video & renderer
   * @param {string} [options.targetPath='/targets/cards.mind'] - Path to compiled target file
   * @param {Function} [options.onStatusChange] - Callback for debug status updates
   */
  constructor({ container, targetPath = '/targets/cards.mind', onStatusChange = null }) {
    this.container = container;
    this.targetPath = targetPath;
    this.onStatusChange = onStatusChange;

    this.mindarThree = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.anchors = [];
    this.isRunning = false;

    this.trackingEnabled = true;
    this.qualityMode = 'NORMAL';

    // Video & Scene Objects (Created once)
    this.videoElement = null;
    this.videoRoot = null;
    this.videoMesh = null;
    this.videoTexture = null;
    this.videoInfo = { res: '---', aspect: '---', plane: '---' };
    this.videoState = ENABLE_VIDEO ? 'IDLE' : 'DISABLED';

    // Debug Assets
    this.debugPlaneGeometry = null;
    this.debugPlaneMaterial = null;
    this.debugPlaneMesh = null;

    // Spatial Audio Tracking State
    this.targetPos = new THREE.Vector3();
    this.targetVolume = 0;
    this.currentVolume = 0;
    this.currentDistance = 0;
    this.isTargetFound = false;
    this.lastAudioCalcTime = 0;
    this.audioLocked = false;
  }

  /**
   * Helper to emit status to debug panel
   */
  updateStatus(statusObj) {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(statusObj);
    }
  }

  /**
   * Check if cards.mind exists before attempting MindAR startup
   */
  async checkTargetExists() {
    try {
      const response = await fetch(this.targetPath, { method: 'HEAD' });
      if (!response.ok) {
        const getRes = await fetch(this.targetPath);
        return getRes.ok;
      }
      return true;
    } catch (e) {
      console.warn('Target file check error:', e);
      return false;
    }
  }

  /**
   * Initialize MindAR and Three.js scene
   */
  async init() {
    this.updateStatus({ startupStage: 'MINDAR INIT' });

    // 1. Verify target file exists
    const targetExists = await this.checkTargetExists();
    if (!targetExists) {
      this.updateStatus({
        targetFileMissing: true,
        mindarStatus: 'ERROR',
        targetStatus: 'MISSING',
        startupStage: 'ERROR: TARGET MISSING',
        message: `Target file not found at ${this.targetPath}`
      });
      throw new Error(`TARGET FILE MISSING: ${this.targetPath} does not exist.`);
    }

    // 2. Instantiate MindARThree instance (Single-target maxTrack: 1)
    this.mindarThree = new MindARThree({
      container: this.container,
      imageTargetSrc: this.targetPath,
      maxTrack: 1,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
      filterMinCF: 0.0001,  // Enhanced tracking stabilization parameters
      filterBeta: 0.001
    });

    const { renderer, scene, camera } = this.mindarThree;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // Apply quality pixel ratio cap
    this.setQualityMode(this.qualityMode);

    // 3. Register Image Target 0 & Attach Video AR Plane
    this.setupAnchor(0);

    this.updateStatus({
      mindarStatus: 'READY',
      targetStatus: 'SEARCHING'
    });
  }

  /**
   * Set Quality Mode (NORMAL = max 1.5 ratio, PERFORMANCE = 1.0 ratio)
   * @param {'NORMAL' | 'PERFORMANCE'} mode 
   */
  setQualityMode(mode = 'NORMAL') {
    this.qualityMode = mode;
    if (!this.renderer) return;

    const targetRatio = mode === 'PERFORMANCE' 
      ? 1.0 
      : Math.min(window.devicePixelRatio, 1.5);

    this.renderer.setPixelRatio(targetRatio);
    console.log(`[CardAR] Quality mode set to ${mode}. Active Pixel Ratio: ${targetRatio}`);

    this.updateStatus({
      qualityMode: this.qualityMode,
      pixelRatio: targetRatio.toFixed(2)
    });
  }

  /**
   * Pre-create and warm up audio on video element during initial user gesture frame
   */
  warmUpAudio() {
    if (!this.videoElement) {
      const video = document.createElement('video');
      video.src = VIDEO_PATH;
      video.loop = true;
      video.muted = false; // Set muted to false during user gesture
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.preload = 'auto';

      this.videoElement = video;
    } else {
      this.videoElement.muted = false;
    }

    // Try starting audio playback inside direct user click event loop
    const p = this.videoElement.play();
    if (p !== undefined) {
      p.then(() => {
        // Immediately pause until target is actually tracked
        this.videoElement.pause();
        this.audioLocked = false;
        console.log('[CardAR] Audio successfully unlocked during user gesture warmup.');
      }).catch((err) => {
        console.warn('[CardAR] Mobile browser restricted unmuted autoplay during gesture:', err);
        this.videoElement.muted = true;
        this.audioLocked = true;
        this.updateStatus({ audioLocked: true });
      });
    }
  }

  /**
   * Attempt to unmute video audio on explicit user interaction
   */
  async unmuteAudio() {
    if (!this.videoElement) return false;
    try {
      this.videoElement.muted = false;
      const playPromise = this.videoElement.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      this.audioLocked = false;
      this.updateStatus({ audioLocked: false, audioMuted: false });
      console.log('[CardAR] Audio successfully unmuted by user action.');
      return true;
    } catch (e) {
      console.warn('[CardAR] Audio unmute attempt failed:', e);
      this.audioLocked = true;
      this.updateStatus({ audioLocked: true, message: 'Unmute failed: ' + e.message });
      return false;
    }
  }

  /**
   * Cleanly pause/resume MindAR tracking processing via supported API
   * @param {boolean} enabled 
   */
  toggleTracking(enabled) {
    this.trackingEnabled = enabled;
    if (!this.mindarThree || !this.mindarThree.controller) return;

    try {
      if (enabled) {
        this.mindarThree.controller.processVideo(this.mindarThree.video);
        console.log('[CardAR] MindAR tracking resumed');
      } else {
        this.mindarThree.controller.stopProcessVideo();
        console.log('[CardAR] MindAR tracking paused (Camera Only mode)');
      }
    } catch (e) {
      console.warn('[CardAR] Toggle tracking error:', e);
    }

    this.updateStatus({
      trackingEnabled: this.trackingEnabled
    });
  }

  /**
   * Initialize Video Plane independently (Non-blocking: failures won't abort camera start)
   * @param {Object} anchor 
   */
  initVideoPlane(anchor) {
    if (!ENABLE_VIDEO) {
      console.log('[CardAR] ENABLE_VIDEO = false. Bypassing video initialization.');
      this.videoState = 'DISABLED';
      this.updateStatus({ videoState: 'DISABLED' });
      return;
    }

    try {
      const videoRoot = new THREE.Group();
      videoRoot.visible = false;
      anchor.group.add(videoRoot);
      this.videoRoot = videoRoot;

      // Use existing video element if created during warmUpAudio, or create HTML5 Video element
      const video = this.videoElement || document.createElement('video');
      if (!this.videoElement) {
        video.src = VIDEO_PATH;
        video.loop = true;
        video.muted = false;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.preload = 'auto';
        this.videoElement = video;
      }

      this.videoState = 'LOADING';
      this.updateStatus({ videoState: 'LOADING' });

      const setupVideoPlane = () => {
        try {
          // Safeguard: Ensure valid non-zero dimensions to prevent NaN aspect ratios
          const vWidth = (video.videoWidth && video.videoWidth > 0) ? video.videoWidth : 16;
          const vHeight = (video.videoHeight && video.videoHeight > 0) ? video.videoHeight : 9;
          const videoAspect = vWidth / vHeight;

          const planeWidth = VIDEO_WIDTH;
          const planeHeight = planeWidth / videoAspect;

          this.videoTexture = new THREE.VideoTexture(video);
          this.videoTexture.minFilter = THREE.LinearFilter;
          this.videoTexture.magFilter = THREE.LinearFilter;

          const videoGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
          const videoMaterial = new THREE.MeshBasicMaterial({
            map: this.videoTexture,
            side: THREE.DoubleSide
          });

          this.videoMesh = new THREE.Mesh(videoGeometry, videoMaterial);
          this.videoMesh.position.set(VIDEO_OFFSET_X, VIDEO_OFFSET_Y, VIDEO_OFFSET_Z);
          this.videoMesh.visible = true;

          this.videoRoot.add(this.videoMesh);

          this.videoInfo = {
            res: `${vWidth}x${vHeight}`,
            aspect: videoAspect.toFixed(2),
            plane: `${planeWidth.toFixed(2)}x${planeHeight.toFixed(2)}`
          };

          this.videoState = 'READY';
          console.log(`[CardAR] Video plane created. Res: ${this.videoInfo.res}, Aspect: ${this.videoInfo.aspect}, Plane: ${this.videoInfo.plane}`);
          
          this.updateStatus({
            videoState: 'READY',
            videoRes: this.videoInfo.res,
            videoAspect: this.videoInfo.aspect,
            videoPlane: this.videoInfo.plane
          });
        } catch (planeErr) {
          console.error('[CardAR] Error constructing video plane:', planeErr);
          this.videoState = 'ERROR';
          this.updateStatus({ videoState: 'ERROR', message: planeErr.message });
        }
      };

      if (video.readyState >= 1) {
        setupVideoPlane();
      } else {
        video.addEventListener('loadedmetadata', setupVideoPlane, { once: true });
      }

      video.addEventListener('error', (e) => {
        console.error('[CardAR] Video load error:', e);
        this.videoState = 'ERROR';
        this.updateStatus({ videoState: 'ERROR', message: 'Video failed to load' });
      });
    } catch (err) {
      console.error('[CardAR] Non-fatal initVideoPlane error:', err);
      this.videoState = 'ERROR';
      this.updateStatus({ videoState: 'ERROR', message: err.message });
    }
  }

  /**
   * Setup image target anchor 0, construct video plane & debug plane
   * @param {number} targetIndex 
   */
  setupAnchor(targetIndex) {
    const anchor = this.mindarThree.addAnchor(targetIndex);

    // ---------------------------------------------------------------------
    // A. Phase 1 Debug Plane (Shown if SHOW_ALIGNMENT_DEBUG = true or ENABLE_VIDEO = false)
    // ---------------------------------------------------------------------
    this.debugPlaneGeometry = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
    this.debugPlaneMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide
    });

    this.debugPlaneMesh = new THREE.Mesh(this.debugPlaneGeometry, this.debugPlaneMaterial);
    this.debugPlaneMesh.position.set(0, 0, CARD_Z_OFFSET);
    this.debugPlaneMesh.visible = false;
    anchor.group.add(this.debugPlaneMesh);

    // ---------------------------------------------------------------------
    // B. Video AR Plane (Isolated in try/catch)
    // ---------------------------------------------------------------------
    this.initVideoPlane(anchor);

    // ---------------------------------------------------------------------
    // C. Target Tracking Event Callbacks
    // ---------------------------------------------------------------------
    anchor.onTargetFound = () => {
      console.log(`[CardAR] Target ${targetIndex} Found`);
      this.isTargetFound = true;

      // Show video plane & play from start if enabled
      if (ENABLE_VIDEO && this.videoRoot) {
        this.videoRoot.visible = true;
      }

      if (ENABLE_VIDEO && this.videoElement) {
        this.videoElement.currentTime = 0;

        // Try unmuting inside gesture execution chain if audio is supported
        if (ENABLE_SPATIAL_AUDIO && !this.audioLocked) {
          this.videoElement.muted = false;
        }

        const playPromise = this.videoElement.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              this.videoState = 'PLAYING';
              this.updateStatus({ videoState: 'PLAYING', audioLocked: false });
            })
            .catch((err) => {
              console.warn('[CardAR] Video play catch (audio playback lock check):', err);
              // Fallback to muted playback if browser blocked unmuted autoplay
              if (this.videoElement.muted === false) {
                this.videoElement.muted = true;
                this.audioLocked = true;
                this.videoElement.play().catch((e2) => {
                  console.error('[CardAR] Muted fallback play error:', e2);
                });
              }
              this.videoState = 'PLAY LOCKED';
              this.updateStatus({ videoState: 'PLAY LOCKED', audioLocked: true, message: err.message });
            });
        } else {
          this.videoState = 'PLAYING';
          this.updateStatus({ videoState: 'PLAYING' });
        }
      }

      // Show green debug plane if SHOW_ALIGNMENT_DEBUG = true OR ENABLE_VIDEO = false
      if ((SHOW_ALIGNMENT_DEBUG || !ENABLE_VIDEO) && this.debugPlaneMesh) {
        this.debugPlaneMesh.visible = true;
      }

      this.updateStatus({
        targetStatus: 'FOUND',
        targetIndex: targetIndex,
        trackingActive: true
      });
    };

    anchor.onTargetLost = () => {
      console.log(`[CardAR] Target ${targetIndex} Lost`);
      this.isTargetFound = false;
      this.targetVolume = 0; // Target volume decays to 0

      // Pause video & hide video plane
      if (ENABLE_VIDEO && this.videoElement) {
        this.videoElement.pause();
        this.videoState = 'PAUSED';
        this.updateStatus({ videoState: 'PAUSED' });
      }

      if (this.videoRoot) {
        this.videoRoot.visible = false;
      }

      if (this.debugPlaneMesh) {
        this.debugPlaneMesh.visible = false;
      }

      this.updateStatus({
        targetStatus: 'LOST',
        targetIndex: targetIndex,
        trackingActive: false,
        arDistance: '---',
        audioVolume: '0%'
      });
    };

    this.anchors.push({
      index: targetIndex,
      anchor,
      debugPlane: this.debugPlaneMesh,
      videoRoot: this.videoRoot
    });
  }

  /**
   * Start AR camera stream & tracking loop (Guarded against duplicate calls)
   */
  async start() {
    if (this.isRunning) {
      console.warn('[CardAR] AR session is already running.');
      return;
    }

    if (!this.mindarThree) {
      await this.init();
    }

    try {
      this.updateStatus({ startupStage: 'CAMERA STARTING', cameraStatus: 'STARTING' });
      await this.mindarThree.start();
      this.isRunning = true;

      this.updateStatus({
        startupStage: 'AR READY',
        cameraStatus: 'ACTIVE',
        mindarStatus: 'TRACKING'
      });

      // Frame time & FPS Telemetry Loop (DOM HUD updates throttled to once per second)
      let frameCount = 0;
      let lastFpsCalcTime = performance.now();
      let lastFrameTimestamp = performance.now();
      let currentFps = 0;
      let currentFrameTime = 0;

      this.renderer.setAnimationLoop(() => {
        const now = performance.now();
        currentFrameTime = now - lastFrameTimestamp;
        lastFrameTimestamp = now;
        frameCount++;

        // ---------------------------------------------------------------------
        // Spatial Audio Calculation & Volume Lerping
        // ---------------------------------------------------------------------
        if (ENABLE_SPATIAL_AUDIO && this.videoElement) {
          // A. Calculate Target Volume at 10-20 Hz (~50-100ms interval)
          if (this.isTargetFound && this.anchors[0] && this.anchors[0].anchor.group) {
            if (now - this.lastAudioCalcTime >= 60) {
              this.lastAudioCalcTime = now;
              this.anchors[0].anchor.group.getWorldPosition(this.targetPos);
              this.currentDistance = this.targetPos.length();

              // Smoothstep proximity calculation (MIN_AUDIO_DIST = 1.0 vol, MAX_AUDIO_DIST = 0.0 vol)
              const t = Math.min(Math.max((MAX_AUDIO_DIST - this.currentDistance) / (MAX_AUDIO_DIST - MIN_AUDIO_DIST), 0), 1);
              this.targetVolume = t * t * (3 - 2 * t);
            }
          } else {
            this.targetVolume = 0;
          }

          // B. Per-frame Volume Smooth Lerp
          this.currentVolume += (this.targetVolume - this.currentVolume) * 0.15;
          if (Math.abs(this.currentVolume - this.targetVolume) < 0.001) {
            this.currentVolume = this.targetVolume;
          }

          // Apply volume to HTML5 video element
          this.videoElement.volume = this.currentVolume;
        }

        // Render Three.js scene
        this.renderer.render(this.scene, this.camera);

        // Throttle telemetry updates to 1000ms (1 second) to prevent DOM thrashing
        if (now - lastFpsCalcTime >= 1000) {
          currentFps = Math.round((frameCount * 1000) / (now - lastFpsCalcTime));
          frameCount = 0;
          lastFpsCalcTime = now;

          const videoEl = this.mindarThree ? this.mindarThree.video : null;
          const camRes = videoEl ? `${videoEl.videoWidth}x${videoEl.videoHeight}` : 'N/A';
          const renderRes = this.renderer ? `${this.renderer.domElement.width}x${this.renderer.domElement.height}` : 'N/A';
          const activePixelRatio = this.renderer ? this.renderer.getPixelRatio().toFixed(2) : '1.0';

          this.updateStatus({
            fps: currentFps,
            frameTime: currentFrameTime.toFixed(1),
            camRes: camRes,
            renderRes: renderRes,
            pixelRatio: activePixelRatio,
            qualityMode: this.qualityMode,
            trackingEnabled: this.trackingEnabled,
            videoState: this.videoState,
            videoRes: this.videoInfo.res,
            videoAspect: this.videoInfo.aspect,
            videoPlane: this.videoInfo.plane,
            arDistance: this.isTargetFound ? this.currentDistance.toFixed(2) : '---',
            audioVolume: `${Math.round(this.currentVolume * 100)}%`
          });
        }
      });
    } catch (error) {
      console.error('[CardAR] Error starting camera/MindAR:', error);
      this.updateStatus({
        startupStage: 'START ERROR',
        cameraStatus: 'ERROR',
        mindarStatus: 'ERROR',
        message: error.message
      });
      throw error;
    }
  }

  /**
   * Stop AR session & release resources
   */
  stop() {
    if (this.videoElement) {
      this.videoElement.pause();
    }
    if (this.mindarThree && this.isRunning) {
      this.mindarThree.stop();
      this.isRunning = false;
      this.updateStatus({
        startupStage: 'STOPPED',
        cameraStatus: 'INACTIVE',
        mindarStatus: 'STOPPED',
        trackingActive: false
      });
    }
  }
}
