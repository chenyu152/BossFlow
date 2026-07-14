import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bossflowDesktop', Object.freeze({
  getRuntimeToken: () => ipcRenderer.invoke('bossflow:get-runtime-token'),
}));
