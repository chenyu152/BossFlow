import { useEffect, useLayoutEffect, useState } from 'react';
import { X } from 'lucide-react';

export type GuidedTourStep = {
  target: string;
  title: string;
  body: string;
};

export function GuidedTour({
  steps,
  activeStep,
  onStepChange,
  onClose,
  nextLabel,
  previousLabel,
  finishLabel,
  skipLabel,
  progressLabel,
}: {
  steps: GuidedTourStep[];
  activeStep: number;
  onStepChange: (step: number) => void;
  onClose: () => void;
  nextLabel: string;
  previousLabel: string;
  finishLabel: string;
  skipLabel: string;
  progressLabel: (current: number, total: number) => string;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[activeStep];

  useLayoutEffect(() => {
    if (!step) return;
    const updateRect = () => {
      const element = document.querySelector<HTMLElement>(`[data-guide-target="${step.target}"]`);
      if (!element) {
        setRect(null);
        return;
      }
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      setRect(element.getBoundingClientRect());
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [step]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight' && activeStep < steps.length - 1) onStepChange(activeStep + 1);
      if (event.key === 'ArrowLeft' && activeStep > 0) onStepChange(activeStep - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeStep, onClose, onStepChange, steps.length]);

  if (!step) return null;
  const bubbleTop = rect ? Math.min(rect.bottom + 16, window.innerHeight - 220) : 120;
  const bubbleLeft = rect ? Math.max(16, Math.min(rect.left, window.innerWidth - 420)) : 24;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={step.title}>
      {rect ? (
        <>
          <div className="absolute inset-x-0 top-0 bg-black/75" style={{ height: Math.max(0, rect.top - 6) }} />
          <div className="absolute left-0 bg-black/75" style={{ top: rect.top - 6, width: Math.max(0, rect.left - 6), height: rect.height + 12 }} />
          <div className="absolute right-0 bg-black/75" style={{ top: rect.top - 6, left: rect.right + 6, height: rect.height + 12 }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/75" style={{ top: rect.bottom + 6 }} />
        </>
      ) : <div className="absolute inset-0 bg-black/75" />}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg border-2 border-cyan-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.01)] transition-all duration-200 motion-reduce:transition-none"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <section
        className="absolute w-[min(400px,calc(100vw-32px))] rounded-lg border border-cyan-800 bg-zinc-950 p-4 shadow-2xl"
        style={{ top: bubbleTop, left: bubbleLeft }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-cyan-300">{progressLabel(activeStep + 1, steps.length)}</p>
            <h2 className="mt-1 text-base font-semibold text-zinc-100">{step.title}</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200" aria-label={skipLabel}>
            <X size={18} />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-zinc-400">{step.body}</p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-300">{skipLabel}</button>
          <div className="flex gap-2">
            {activeStep > 0 && <button onClick={() => onStepChange(activeStep - 1)} className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900">{previousLabel}</button>}
            <button onClick={() => activeStep === steps.length - 1 ? onClose() : onStepChange(activeStep + 1)} className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
              {activeStep === steps.length - 1 ? finishLabel : nextLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
