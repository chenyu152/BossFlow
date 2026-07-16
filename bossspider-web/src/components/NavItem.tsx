import type { ReactNode } from 'react';

export function NavItem({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        onClick();
        if (event.detail > 0) event.currentTarget.blur();
      }}
      aria-current={active ? 'page' : undefined}
      className={`nav-subitem relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa] dark:focus-visible:outline-[#7fb1ff] ${
        active
          ? 'nav-subitem--active bg-[#eff6ff] text-[#1d4ed8] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-md before:bg-[#2563eb] before:content-[\'\'] dark:bg-[#142a49] dark:text-[#7fb1ff] dark:before:bg-[#3478f6]'
          : 'bg-transparent text-[#5e6b7e] hover:bg-[#f8fafc] hover:text-[#172033] dark:text-[#a1a1aa] dark:hover:bg-[#162d47] dark:hover:text-[#f2f6fc]'
      }`}
    >
      <span className={`nav-subitem__icon ${active ? 'text-[#2563eb] dark:text-[#7fb1ff]' : 'text-[#77859a] dark:text-[#71717a]'}`}>{icon}</span>
      {label}
    </button>
  );
}
