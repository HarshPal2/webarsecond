import { CardAR } from './ar/CardAR.js';

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const startBtn = document.getElementById('start-btn');
  const startOverlay = document.getElementById('start-overlay');
  const arContainer = document.getElementById('ar-container');
  const missingTargetBanner = document.getElementById('missing-target-banner');

  // Debug Panel Elements
  const debugPanel = document.getElementById('debug-panel');
  const debugHeader = document.getElementById('debug-header');
  const debugToggle = document.getElementById('debug-toggle');
  
  // Telemetry HUD Elements
  const statusFps = document.getElementById('status-fps');
  const statusFrameTime = document.getElementById('status-frametime');
  const statusCamRes = document.getElementById('status-camres');
  const statusRenderRes = document.getElementById('status-renderres');
  const statusPixelRatio = document.getElementById('status-pixelratio');

  const statusVideostate = document.getElementById('status-videostate');
  const statusVideores = document.getElementById('status-videores');
  const statusVideoaspect = document.getElementById('status-videoaspect');
  const statusVideoplane = document.getElementById('status-videoplane');

  const statusArdistance = document.getElementById('status-ardistance');
  const statusAudiovolume = document.getElementById('status-audiovolume');
  const rowUnmute = document.getElementById('row-unmute');
  const btnUnmuteAudio = document.getElementById('btn-unmute-audio');

  const btnToggleQuality = document.getElementById('btn-toggle-quality');
  const btnToggleTracking = document.getElementById('btn-toggle-tracking');

  const statusNetwork = document.getElementById('status-network');
  const statusSecure = document.getElementById('status-secure');
  const statusHost = document.getElementById('status-host');
  const statusStartup = document.getElementById('status-startup');

  const statusCamera = document.getElementById('status-camera');
  const statusMindar = document.getElementById('status-mindar');
  const statusTarget = document.getElementById('status-target');
  const statusIndex = document.getElementById('status-index');
  const statusTracking = document.getElementById('status-tracking');

  let cardAR = null;
  let currentQualityMode = 'NORMAL';
  let isTrackingEnabled = true;

  // Network Diagnostic Logging
  const targetUrl = new URL('/targets/cards.mind', window.location.origin).href;
  console.log('=== WEBAR NETWORK DIAGNOSTIC ===');
  console.log('CURRENT ORIGIN:', window.location.origin);
  console.log('SECURE CONTEXT:', window.isSecureContext);
  console.log('HOSTNAME:', window.location.hostname);
  console.log('TARGET URL:', targetUrl);
  console.log('=================================');

  if (statusHost) statusHost.textContent = window.location.hostname;
  if (statusSecure) {
    statusSecure.textContent = window.isSecureContext ? 'YES' : 'NO';
    statusSecure.className = `status-badge ${window.isSecureContext ? 'status-on' : 'status-err'}`;
  }

  // 1. Debug Panel Collapse Toggle
  debugHeader.addEventListener('click', () => {
    const isCollapsed = debugPanel.classList.toggle('collapsed');
    debugToggle.textContent = isCollapsed ? '[ EXPAND ]' : '[ CLOSE ]';
  });

  // 2. Interactive Test Buttons
  btnToggleQuality.addEventListener('click', (e) => {
    e.stopPropagation();
    currentQualityMode = (currentQualityMode === 'NORMAL') ? 'PERFORMANCE' : 'NORMAL';
    btnToggleQuality.textContent = `QUALITY: ${currentQualityMode}`;
    if (cardAR) {
      cardAR.setQualityMode(currentQualityMode);
    }
  });

  btnToggleTracking.addEventListener('click', (e) => {
    e.stopPropagation();
    isTrackingEnabled = !isTrackingEnabled;
    btnToggleTracking.textContent = isTrackingEnabled ? 'TRACKING: ON' : 'TRACKING: OFF';
    btnToggleTracking.style.borderColor = isTrackingEnabled ? 'var(--glass-border)' : 'var(--accent-amber)';
    if (cardAR) {
      cardAR.toggleTracking(isTrackingEnabled);
    }
  });

  if (btnUnmuteAudio) {
    btnUnmuteAudio.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (cardAR) {
        const success = await cardAR.unmuteAudio();
        if (success && rowUnmute) {
          rowUnmute.classList.add('hidden');
        }
      }
    });
  }

  // 3. Status Update Callback
  function updateDebugUI(status) {
    if (status.fps !== undefined && statusFps) {
      statusFps.textContent = status.fps;
    }
    if (status.frameTime !== undefined && statusFrameTime) {
      statusFrameTime.textContent = `${status.frameTime} ms`;
    }
    if (status.camRes !== undefined && statusCamRes) {
      statusCamRes.textContent = status.camRes;
    }
    if (status.renderRes !== undefined && statusRenderRes) {
      statusRenderRes.textContent = status.renderRes;
    }
    if (status.pixelRatio !== undefined && statusPixelRatio) {
      statusPixelRatio.textContent = status.pixelRatio;
    }

    if (status.videoState !== undefined && statusVideostate) {
      statusVideostate.textContent = status.videoState;
      statusVideostate.className = `status-badge ${
        status.videoState === 'PLAYING' ? 'status-on' :
        status.videoState === 'READY' || status.videoState === 'PAUSED' ? 'status-warn' :
        status.videoState === 'ERROR' ? 'status-err' : 'status-off'
      }`;
    }
    if (status.videoRes !== undefined && statusVideores) {
      statusVideores.textContent = status.videoRes;
    }
    if (status.videoAspect !== undefined && statusVideoaspect) {
      statusVideoaspect.textContent = status.videoAspect;
    }
    if (status.videoPlane !== undefined && statusVideoplane) {
      statusVideoplane.textContent = status.videoPlane;
    }

    if (status.arDistance !== undefined && statusArdistance) {
      statusArdistance.textContent = status.arDistance;
    }
    if (status.audioVolume !== undefined && statusAudiovolume) {
      statusAudiovolume.textContent = status.audioVolume;
    }
    if (status.audioLocked !== undefined && rowUnmute) {
      if (status.audioLocked) {
        rowUnmute.classList.remove('hidden');
      } else {
        rowUnmute.classList.add('hidden');
      }
    }

    if (status.startupStage !== undefined && statusStartup) {
      statusStartup.textContent = status.startupStage;
      statusStartup.className = `status-badge ${
        status.startupStage === 'AR READY' ? 'status-on' :
        status.startupStage.includes('ERROR') ? 'status-err' : 'status-warn'
      }`;
    }

    if (status.networkStatus !== undefined) {
      statusNetwork.textContent = status.networkStatus;
      statusNetwork.className = `status-badge ${status.networkStatus === 'READY' ? 'status-on' : 'status-err'}`;
    }
    if (status.cameraStatus !== undefined) {
      statusCamera.textContent = status.cameraStatus;
      statusCamera.className = `status-badge ${
        status.cameraStatus === 'ACTIVE' ? 'status-on' :
        status.cameraStatus === 'ERROR' ? 'status-err' : 'status-off'
      }`;
    }

    if (status.mindarStatus !== undefined) {
      statusMindar.textContent = status.mindarStatus;
      statusMindar.className = `status-badge ${
        status.mindarStatus === 'READY' || status.mindarStatus === 'TRACKING' ? 'status-on' :
        status.mindarStatus === 'ERROR' ? 'status-err' : 'status-off'
      }`;
    }

    if (status.targetStatus !== undefined) {
      statusTarget.textContent = status.targetStatus;
      statusTarget.className = `status-badge ${
        status.targetStatus === 'FOUND' ? 'status-on' :
        status.targetStatus === 'SEARCHING' || status.targetStatus === 'LOST' ? 'status-warn' :
        status.targetStatus === 'MISSING' ? 'status-err' : 'status-off'
      }`;
    }

    if (status.targetIndex !== undefined) {
      statusIndex.textContent = status.targetIndex;
    }

    if (status.trackingActive !== undefined) {
      statusTracking.textContent = status.trackingActive ? 'YES' : 'NO';
      statusTracking.className = `status-badge ${status.trackingActive ? 'status-on' : 'status-off'}`;
    }
  }

  // 4. Pre-flight Check for cards.mind
  async function checkTargetFileOnLoad() {
    const targetPath = '/targets/cards.mind';
    try {
      const res = await fetch(targetPath, { method: 'HEAD' });
      if (!res.ok) {
        const getRes = await fetch(targetPath);
        if (!getRes.ok) throw new Error('Target file HTTP status ' + getRes.status);
      }
    } catch (e) {
      console.warn('[Main] cards.mind target file check failed:', e.message);
      missingTargetBanner.classList.remove('hidden');
      updateDebugUI({
        targetStatus: 'MISSING'
      });
    }
  }

  checkTargetFileOnLoad();

  // 5. START AR Button Click Handler
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="btn-icon">⏳</span> STARTING...';

    try {
      cardAR = new CardAR({
        container: arContainer,
        targetPath: '/targets/cards.mind',
        onStatusChange: updateDebugUI
      });

      await cardAR.start();
      
      // Hide start overlay once camera stream & MindAR start successfully
      startOverlay.classList.add('hidden');
    } catch (error) {
      console.error('[Main] AR Initialization Error:', error);
      startBtn.disabled = false;
      startBtn.innerHTML = '<span class="btn-icon">⚠️</span> RETRY AR';
      
      // If error was missing target file, ensure banner is visible
      if (error.message.includes('TARGET FILE MISSING')) {
        missingTargetBanner.classList.remove('hidden');
      } else {
        alert(`Camera/AR Error: ${error.message}`);
      }
    }
  });
});
