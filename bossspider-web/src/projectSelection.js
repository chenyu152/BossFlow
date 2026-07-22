export function chooseInitialProject(projects, defaultProject, rememberedProject) {
  if (!projects.length) return '';
  if (rememberedProject && projects.includes(rememberedProject)) return rememberedProject;
  if (defaultProject && projects.includes(defaultProject)) return defaultProject;
  return projects[0];
}

export function chooseAccountProfileProject(projects, activeProject, rememberedProfile) {
  if (!activeProject || !projects.includes(activeProject)) return '';
  if (rememberedProfile && projects.includes(rememberedProfile)) return rememberedProfile;
  return activeProject;
}
