interface BossFlowDesktopBridge {
  getRuntimeToken: () => Promise<string>;
}

declare global {
  interface Window {
    bossflowDesktop?: BossFlowDesktopBridge;
  }
}

export {};
