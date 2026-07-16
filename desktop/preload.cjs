const { contextBridge, ipcRenderer } = require('electron');

// Keep the bridge deliberately narrow: the renderer may only announce its
// resolved color theme. API credentials remain in Electron's main process.
contextBridge.exposeInMainWorld('bossflowDesktop', {
  platform: process.platform,
  setTheme: (theme) => {
    if (theme === 'dark' || theme === 'light') {
      ipcRenderer.send('bossflow:theme-changed', theme);
    }
  },
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.desktopPlatform = process.platform;
});
