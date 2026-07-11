import { CheckCircle2, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppTranslation } from '../i18n';
import type {
  EvidenceClassification,
  EvidenceCoverage,
  EvidenceItem,
  EvidenceRequirement,
  EvidenceTaskType,
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
  timeBudget: string;
  userWillingness: string;
  taskType: EvidenceTaskType | '';
};

type Choice = { value: string; label: string; description?: string };

function ChoiceGroup({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-zinc-300">{label}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            onClick={() => onChange(choice.value)}
            className={`rounded border px-3 py-2 text-left transition-colors ${
              value === choice.value
                ? 'border-indigo-600 bg-indigo-950/40 text-indigo-100'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900'
            }`}
          >
            <span className="block text-xs font-medium">{choice.label}</span>
            {choice.description && <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">{choice.description}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const { t } = useAppTranslation();
  const [experience, setExperience] = useState('');
  const [role, setRole] = useState('');
  const [actions, setActions] = useState('');
  const [results, setResults] = useState('');
  const [source, setSource] = useState('');
  const [transferable, setTransferable] = useState('');
  const [boundaries, setBoundaries] = useState('');
  const [timeBudget, setTimeBudget] = useState('');
  const [userWillingness, setUserWillingness] = useState('');
  const [taskType, setTaskType] = useState<EvidenceTaskType | ''>('');

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
    setTimeBudget('');
    setUserWillingness('');
    setTaskType('');
  }, [candidateEvidenceRefs, classification, existingEvidence?.evidenceId, requirement.requirementId]);

  const valid = useMemo(() => {
    if (classification === 'done') {
      if (compactCandidateReview) return Boolean(experience.trim() && source.trim());
      return Boolean(experience.trim() && role.trim() && actions.trim() && results.trim() && source.trim());
    }
    if (classification === 'adjacent') {
      return Boolean(experience.trim() && transferable.trim() && boundaries.trim());
    }
    return Boolean(timeBudget && userWillingness && taskType);
  }, [actions, boundaries, classification, compactCandidateReview, experience, results, role, source, taskType, timeBudget, transferable, userWillingness]);

  const timeChoices: Choice[] = [
    { value: 'none', label: t('jobWorkspace.evidence.dialog.time.none') },
    { value: 'under_1_hour', label: t('jobWorkspace.evidence.dialog.time.underOneHour') },
    { value: '1_3_days', label: t('jobWorkspace.evidence.dialog.time.oneToThreeDays') },
    { value: '1_3_weeks', label: t('jobWorkspace.evidence.dialog.time.oneToThreeWeeks') },
    { value: 'long_term', label: t('jobWorkspace.evidence.dialog.time.longTerm') },
  ];
  const willingnessChoices: Choice[] = [
    { value: 'yes', label: t('jobWorkspace.evidence.dialog.willingness.yes') },
    { value: 'unsure', label: t('jobWorkspace.evidence.dialog.willingness.unsure') },
    { value: 'no', label: t('jobWorkspace.evidence.dialog.willingness.no') },
  ];
  const actionChoices: Choice[] = [
    { value: 'accept_risk', label: t('jobWorkspace.evidence.dialog.actions.acceptRisk'), description: t('jobWorkspace.evidence.dialog.actions.acceptRiskDesc') },
    { value: 'learn', label: t('jobWorkspace.evidence.dialog.actions.learn'), description: t('jobWorkspace.evidence.dialog.actions.learnDesc') },
    { value: 'project', label: t('jobWorkspace.evidence.dialog.actions.project'), description: t('jobWorkspace.evidence.dialog.actions.projectDesc') },
    { value: 'ignore', label: t('jobWorkspace.evidence.dialog.actions.ignore'), description: t('jobWorkspace.evidence.dialog.actions.ignoreDesc') },
  ];

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
      timeBudget,
      userWillingness,
      taskType,
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

          {classification === 'done' && !compactCandidateReview && (
            <>
              <TextField label={t('jobWorkspace.evidence.dialog.experience')} value={experience} onChange={setExperience} placeholder={t('jobWorkspace.evidence.dialog.experiencePlaceholder')} />
              <TextField label={t('jobWorkspace.evidence.dialog.role')} value={role} onChange={setRole} placeholder={t('jobWorkspace.evidence.dialog.rolePlaceholder')} rows={2} />
              <TextField label={t('jobWorkspace.evidence.dialog.actionsLabel')} value={actions} onChange={setActions} placeholder={t('jobWorkspace.evidence.dialog.actionsPlaceholder')} />
              <TextField label={t('jobWorkspace.evidence.dialog.results')} value={results} onChange={setResults} placeholder={t('jobWorkspace.evidence.dialog.resultsPlaceholder')} />
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
            <>
              <ChoiceGroup label={t('jobWorkspace.evidence.dialog.timeBudget')} value={timeBudget} choices={timeChoices} onChange={setTimeBudget} />
              <ChoiceGroup label={t('jobWorkspace.evidence.dialog.willingnessLabel')} value={userWillingness} choices={willingnessChoices} onChange={setUserWillingness} />
              <ChoiceGroup label={t('jobWorkspace.evidence.dialog.actionLabel')} value={taskType} choices={actionChoices} onChange={(value) => setTaskType(value as EvidenceTaskType)} />
            </>
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
                  : t('jobWorkspace.evidence.dialog.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
