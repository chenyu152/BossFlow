export type CollectionEstimateInput = {
  keywordsText: string;
  citiesText: string;
  newJobTarget: number;
  maxJobs: number;
  existingJobCount?: number;
};

export type CollectionEstimate = {
  keywordCount: number;
  cityCount: number;
  combinationCount: number;
  estimatedListedJobs: number;
  estimatedDetailJobs: number;
  estimatedReusedJobs: number;
  estimatedStopCondition: 'new_job_target' | 'max_jobs';
  estimatedMinutes: number;
  range: [number, number];
};

export function collectionEstimate(input: CollectionEstimateInput): CollectionEstimate {
  const uniqueLines = (value: string) => new Set(
    value
      .split(/\r?\n/)
      .map((line) => line.trim().toLocaleLowerCase())
      .filter(Boolean),
  ).size;
  const keywordCount = uniqueLines(input.keywordsText);
  const cityCount = uniqueLines(input.citiesText);
  const combinationCount = keywordCount * cityCount;
  if (!combinationCount) {
    return {
      keywordCount,
      cityCount,
      combinationCount,
      estimatedListedJobs: 0,
      estimatedDetailJobs: 0,
      estimatedReusedJobs: 0,
      estimatedStopCondition: 'new_job_target',
      estimatedMinutes: 0,
      range: [0, 0],
    };
  }

  const newTarget = Math.max(1, input.newJobTarget || 1);
  const totalLimit = Math.max(1, input.maxJobs || 1);
  const newJobRatio = (input.existingJobCount || 0) > 0 ? .27 : 1;
  const listedToReachNewTarget = Math.ceil(newTarget / newJobRatio);
  const listedPerSearch = Math.min(totalLimit, listedToReachNewTarget);
  const scrollRounds = Math.max(1, Math.ceil(listedPerSearch / 20));
  const estimatedListedJobs = listedPerSearch * combinationCount;
  const detailPerSearch = Math.min(listedPerSearch, Math.ceil(listedPerSearch * newJobRatio));
  const estimatedDetailJobs = detailPerSearch * combinationCount;
  const estimatedReusedJobs = Math.max(0, estimatedListedJobs - estimatedDetailJobs);
  const seconds = 12
    + combinationCount * (10 + scrollRounds * 4)
    + estimatedDetailJobs * 8.7
    + keywordCount * 2
    + cityCount * 3;
  const estimatedMinutes = Math.max(1, Math.ceil(seconds / 60));

  return {
    keywordCount,
    cityCount,
    combinationCount,
    estimatedListedJobs,
    estimatedDetailJobs,
    estimatedReusedJobs,
    estimatedStopCondition: listedToReachNewTarget <= totalLimit ? 'new_job_target' : 'max_jobs',
    estimatedMinutes,
    range: [
      Math.max(1, Math.floor(estimatedMinutes * .9)),
      Math.max(1, Math.ceil(estimatedMinutes * 1.15)),
    ],
  };
}
