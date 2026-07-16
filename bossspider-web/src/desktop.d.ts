import type { AgentAccess, DesktopSettings } from './types';

declare global {
  interface Window {
    bossflowDesktop?: {
      platform: string;
      setTheme: (theme: 'dark' | 'light') => void;
      getSettings: () => Promise<DesktopSettings>;
      setSettings: (settings: Omit<DesktopSettings, 'supported'>) => Promise<DesktopSettings>;
      getAgentAccess: () => Promise<AgentAccess>;
    };
  }
}

export {};
