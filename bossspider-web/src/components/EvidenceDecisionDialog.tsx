import { CheckCircle2, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppTranslation } from '../i18n';
import type {
  EvidenceClassification,
  EvidenceCoverage,
  EvidenceItem,
  EvidenceRequirement,
  ProficiencyLevel,
} from '../types';

export type EvidenceDecisionInput = {
  classification: EvidenceClassification;
  experience: string;
  role: string;
  actions: string;
  results: string;
  source: string;
  transferable: string;
  boundaries: string;
  proficiency: ProficiencyLevel;
};

function TextField({
  label,
  value,
  placeholder,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-zinc-300">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full resize-y rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-6 text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-600"
      />
    </label>
  );
}

export function EvidenceDecisionDialog({
  requirement,
  classification,
  existingEvidence,
  candidateEvidenceRefs = [],
  compactCandidateReview = false,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  requirement: EvidenceRequirement;
  classification: EvidenceClassification;
  existingEvidence?: EvidenceItem | null;
  candidateEvidenceRefs?: EvidenceCoverage['candidateEvidenceRefs'];
  compactCandidateReview?: boolean;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (input: EvidenceDecisionInput) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language).startsWith('zh');
  const [experience, setExperience] = useState('');
  const [role, setRole] = useState('');
  const [actions, setActions] = useState('');
  const [results, setResults] = useState('');
  const [source, setSource] = useState('');
  const [transferable, setTransferable] = useState('');
  const [boundaries, setBoundaries] = useState('');
  const [proficiency, setProficiency] = useState<ProficiencyLevel>('working');

  useEffect(() => {
    const candidateSummary = candidateEvidenceRefs.map((source) => source.quote).filter(Boolean).join('\n');
    const candidateSource = candidateEvidenceRefs.map((source) => source.locator || source.sourceType).filter(Boolean).join('；');
    setExperience(existingEvidence?.summary || candidateSummary);
    setRole(existingEvidence?.userRole || '');
    setActions((existingEvidence?.actions || []).join('\n'));
    setResults((existingEvidence?.results || []).join('\n'));
    setSource(existingEvidence?.sourceRefs?.[0]?.ref || candidateSource);
    setTransferable(classification === 'adjacent' ? (existingEvidence?.actions || []).join('\n') : '');
    setBoundaries(classification === 'adjacent' ? (existingEvidence?.results || []).join('\n') : '');
    setProficiency(
      classification === 'adjacent'
        ? 'familiar'
        : requirement.requiredProficiency && requirement.requiredProficiency !== 'unspecified'
          ? requirement.requiredProficiency
          : 'working',
    );
  }, [candidateEvidenceRefs, classification, existingEvidence?.evidenceId, requirement.requirementId]);

  const valid = useMemo(() => {
    if (classification === 'done') {
      return Boolean(experience.trim() && source.trim());
    }
    if (classification === 'adjacent') {
      return Boolean(experience.trim() && transferable.trim() && boundaries.trim());
    }
    return true;
  }, [actions, boundaries, classification, compactCandidateReview, experience, results, role, source, transferable]);

  const submit = () => {
    if (!valid || saving) return;
    onSubmit({
      classification,
      experience: experience.trim(),
      role: role.trim(),
      actions: actions.trim(),
      results: results.trim(),
      source: source.trim(),
      transferable: transferable.trim(),
      boundaries: boundaries.trim(),
      proficiency,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-5 py-5"
      onClick={() => { if (!saving) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-decision-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-indigo-300">
              {t(`jobWorkspace.evidence.classifications.${classification}`)}
            </div>
            <h3 id="evidence-decision-title" className="mt-1 text-base font-semibold text-zinc-100">{requirement.label}</h3>
            {requirement.jdQuote && <p className="mt-2 text-xs leading-relaxed text-zinc-500">JD：{requirement.jdQuote}</p>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200">
            {t('jobWorkspace.evidence.dialog.factGuardrail')}
          </div>

          {classification === 'done' && compactCandidateReview && (
            <>
              <div className="rounded border border-indigo-900/50 bg-indigo-950/20 p-3 text-xs leading-relaxed text-indigo-200">
                {t('jobWorkspace.evidence.dialog.candidateReviewHint')}
              </div>
              <TextField label={t('jobWorkspace.evidence.dialog.candidateEvidence')} value={experience} onChange={setExperience} placeholder={t('jobWorkspace.evidence.dialog.candidateEvidencePlaceholder')} />
              <TextField label={t('jobWorkspace.evidence.dialog.source')} value={source} onChange={setSource} placeholder={t('jobWorkspace.evidence.dialog.sourcePlaceholder')} rows={2} />
            </>
          )}

          {(classification === 'done' || classification === 'adjacent') && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">
                {isZh ? '我的实际熟练度' : 'My proficiency'}
              </span>
              <select
                value={proficiency}
                onChange={(event) => setProficiency(event.target.value as ProficiencyLevel)}
                className="h-10 w-full rounded border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200 outline-none focus:border-indigo-600"
              >
                <option value="awareness">{isZh ? '了解' : 'Awareness'}</option>
                <option value="familiar">{isZh ? '熟悉' : 'Familiar'}</option>
                <option value="working">{isZh ? '掌握' : 'Working knowledge'}</option>
                <option value="proficient">{isZh ? '熟练' : 'Proficient'}</option>
                <option value="expert">{isZh ? '精通' : 'Expert'}</option>
              </select>
              {requirement.requiredProficiency && requirement.requiredProficiency !== 'unspecified' && (
                <small className="text-[10px] text-zinc-500">
                  {isZh ? '该岗位要求：' : 'Job requirement: '}
                  {{
                    awareness: isZh ? '了解' : 'Awareness',
                    familiar: isZh ? '熟悉' : 'Familiar',
                    working: isZh ? '掌握' : 'Working knowledge',
                    proficient: isZh ? '熟练' : 'Proficient',
                    expert: isZh ? '精通' : 'Expert',
                    unspecified: isZh ? '未说明' : 'Not specified',
                  }[requirement.requiredProficiency]}
                </small>
              )}
            </label>
          )}

          {classification === 'done' && !compactCandidateReview && (
            <>
              <div className="rounded border border-indigo-900/50 bg-indigo-950/20 p-3 text-xs leading-relaxed text-indigo-200">
                {t('jobWorkspace.evidence.dialog.capabilityEvidenceHint', {
                  defaultValue: '这里只确认能够证明该能力的事实和来源。职责、行动与结果属于故事库，不要求在这里重复填写。',
                })}
              </div>
              <TextField label={t('jobWorkspace.evidence.dialog.experience')} value={experience} onChange={setExperience} placeholder={t('jobWorkspace.evidence.dialog.experiencePlaceholder')} />
              <TextField label={t('jobWorkspace.evidence.dialog.source')} value={source} onChange={setSource} placeholder={t('jobWorkspace.evidence.dialog.sourcePlaceholder')} rows={2} />
            </>
          )}

          {classification === 'adjacent' && (
            <>
              <TextField label={t('jobWorkspace.evidence.dialog.adjacentExperience')} value={experience} onChange={setExperience} placeholder={t('jobWorkspace.evidence.dialog.adjacentExperiencePlaceholder')} />
              <TextField label={t('jobWorkspace.evidence.dialog.transferable')} value={transferable} onChange={setTransferable} placeholder={t('jobWorkspace.evidence.dialog.transferablePlaceholder')} />
              <TextField label={t('jobWorkspace.evidence.dialog.boundaries')} value={boundaries} onChange={setBoundaries} placeholder={t('jobWorkspace.evidence.dialog.boundariesPlaceholder')} />
            </>
          )}

          {(classification === 'not_done' || classification === 'unsure') && (
            <div className="rounded border border-indigo-900/50 bg-indigo-950/20 p-4 text-xs leading-relaxed text-indigo-200">
              {t('jobWorkspace.evidence.dialog.deferPlanningHint', {
                defaultValue: classification === 'not_done'
                  ? '这里只记录这项能力目前尚未掌握。系统会先统计它影响多少候选岗位，再由你决定是否加入提升计划。'
                  : '这里只保留为待确认状态，不会自动创建学习任务。你可以稍后在能力档案中统一处理。',
              })}
            </div>
          )}

          {error && <div className="rounded border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-5 py-4">
          <div className="text-[10px] leading-relaxed text-zinc-500">
            {compactCandidateReview
              ? t('jobWorkspace.evidence.dialog.candidateConfirmHint')
              : classification === 'done' || classification === 'adjacent'
              ? t('jobWorkspace.evidence.dialog.draftHint')
              : t('jobWorkspace.evidence.dialog.decisionHint')}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onCancel} disabled={saving} className="rounded border border-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">
              {t('jobWorkspace.evidence.dialog.cancel')}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!valid || saving}
              className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {saving
                ? t('jobWorkspace.evidence.dialog.saving')
                : compactCandidateReview
                  ? t('jobWorkspace.evidence.dialog.confirmAndUse')
                  : (classification === 'not_done' || classification === 'unsure')
                    ? t('jobWorkspace.evidence.dialog.recordGap', { defaultValue: '记录状态' })
                    : t('jobWorkspace.evidence.dialog.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
