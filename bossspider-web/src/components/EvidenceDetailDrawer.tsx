import { FileSearch, Link2, X } from 'lucide-react';
import { useMemo } from 'react';
import { useAppTranslation } from '../i18n';
import type { EvidenceItem, EvidenceOverviewResponse } from '../types';

export function EvidenceDetailDrawer({
  evidence,
  overview,
  jobLabels,
  onClose,
}: {
  evidence: EvidenceItem;
  overview: EvidenceOverviewResponse | null;
  jobLabels: Map<string, string>;
  onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const usages = useMemo(() => {
    const requirementsById = new Map((overview?.requirements || []).map((requirement) => [requirement.requirementId, requirement]));
    return (overview?.coverages || [])
      .filter((coverage) => coverage.evidenceIds.includes(evidence.evidenceId))
      .map((coverage) => {
        const requirement = requirementsById.get(coverage.requirementId);
        if (!requirement) return null;
        return {
          requirementId: requirement.requirementId,
          label: requirement.label,
          jobLabel: jobLabels.get(requirement.sourceKey) || requirement.sourceKey,
          coverageStatus: coverage.coverageStatus,
        };
      })
      .filter((usage): usage is NonNullable<typeof usage> => Boolean(usage));
  }, [evidence.evidenceId, jobLabels, overview?.coverages, overview?.requirements]);

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/70" onMouseDown={onClose}>
      <aside
        className="h-full w-full max-w-xl overflow-y-auto border-l border-zinc-700 bg-zinc-950 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-800 bg-zinc-950 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs text-zinc-500">{t('interview.evidenceDetailTitle')}</div>
            <h3 className="mt-1 text-base font-semibold text-zinc-100">{evidence.title || evidence.evidenceId}</h3>
            <div className="mt-1 font-mono text-xs text-emerald-300">{evidence.evidenceId}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-800 p-2 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
            aria-label={t('interview.closeEvidenceDetail')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-6 p-5 text-sm">
          <section>
            <div className="mb-2 text-xs font-medium text-zinc-500">{t('interview.evidenceSummary')}</div>
            <div className="whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-900/40 p-3 leading-6 text-zinc-200">
              {evidence.summary || t('interview.noEvidenceSummary')}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
              <FileSearch size={13} />
              {t('interview.evidenceSources')}
            </div>
            {evidence.sourceRefs.length ? (
              <div className="space-y-2">
                {evidence.sourceRefs.map((source, index) => (
                  <div key={`${source.type}-${source.ref}-${index}`} className="rounded border border-zinc-800 bg-zinc-900/30 p-3">
                    <div className="text-xs text-cyan-300">{source.ref || source.type}</div>
                    {source.quote && <div className="mt-1 whitespace-pre-wrap leading-6 text-zinc-300">{source.quote}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-500">{t('interview.noEvidenceSources')}</div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
              <Link2 size={13} />
              {t('interview.evidenceUsage')}
            </div>
            {usages.length ? (
              <div className="space-y-2">
                {usages.map((usage) => (
                  <div key={usage.requirementId} className="rounded border border-emerald-900/50 bg-emerald-950/15 p-3">
                    <div className="text-xs text-zinc-500">{usage.jobLabel}</div>
                    <div className="mt-1 text-sm text-emerald-100">{usage.label}</div>
                    <div className="mt-1 text-[11px] text-emerald-300">{usage.coverageStatus}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-500">{t('interview.noEvidenceUsage')}</div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
