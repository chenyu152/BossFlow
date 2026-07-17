import type { EvidenceRequirement } from '../types';

export type RequirementUnit = {
  unitId: string;
  mode: 'all_of' | 'any_of';
  label: string;
  minimumSatisfied: number;
  requirements: EvidenceRequirement[];
};

export function buildRequirementUnits(requirements: EvidenceRequirement[]): RequirementUnit[] {
  const grouped = new Map<string, EvidenceRequirement[]>();
  requirements.forEach((requirement) => {
    const isAnyOf = requirement.requirementGroupMode === 'any_of' && Boolean(requirement.requirementGroupId);
    const unitId = isAnyOf
      ? `any_of:${requirement.sourceKey}:${requirement.requirementGroupId}`
      : `single:${requirement.requirementId}`;
    grouped.set(unitId, [...(grouped.get(unitId) || []), requirement]);
  });

  return [...grouped.entries()].map(([unitId, related]) => {
    const representative = related[0];
    const mode = representative.requirementGroupMode === 'any_of' ? 'any_of' : 'all_of';
    const requestedMinimum = Math.max(1, representative.minimumSatisfied || 1);
    return {
      unitId,
      mode,
      label: mode === 'any_of'
        ? representative.requirementGroupLabel || representative.jdQuote || representative.label
        : representative.capabilityName || representative.label,
      minimumSatisfied: mode === 'any_of'
        ? Math.min(requestedMinimum, related.length)
        : 1,
      requirements: related,
    };
  });
}
