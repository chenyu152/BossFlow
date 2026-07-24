import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../src/', import.meta.url);
const readSource = (name) => readFile(new URL(name, root), 'utf8');

test('dashboard refresh owns a full jobs snapshot separate from job-list search state', async () => {
  const hook = await readSource('hooks/useBossSpider.ts');
  const app = await readSource('App.tsx');

  assert.match(hook, /const \[dashboardJobs, setDashboardJobs\] = useState<Job\[\]\>\(\[\]\);/);
  assert.match(hook, /bossApi\.getJobs\(projectName, '', 20000\)/);
  assert.match(hook, /refreshDashboardResources/);
  assert.match(app, /jobs=\{boss\.dashboardJobs\}/);
  assert.match(app, /jobs=\{boss\.jobs\}/);
});

test('entering dashboard refreshes aggregate resources and actionable activity count', async () => {
  const app = await readSource('App.tsx');

  assert.match(app, /const enteredDashboard = activeTab === 'Dashboard' && previousActiveTabRef\.current !== 'Dashboard'/);
  assert.match(app, /boss\.refreshDashboardResources\(\)/);
  assert.match(app, /refreshAccountActivityNewCount\(\)/);
  assert.match(app, /importStatus: 'pending'/);
  assert.match(app, /jobStatus: 'open'/);
  assert.match(app, /actionableOnly: true/);
});

test('dashboard local story and CV data reload on project or refresh-token changes', async () => {
  const dashboard = await readSource('pages/Dashboard.tsx');

  assert.match(dashboard, /\[config\.project, onLoadStoryDrafts, refreshToken\]/);
  assert.match(dashboard, /\[loadCvStatus, refreshToken\]/);
});

test('account activity mutations notify the app and polling recognizes every server terminal state', async () => {
  const activity = await readSource('pages/AccountActivity.tsx');

  assert.match(activity, /onDataChanged\?\.\(\{ kind: 'import', mode \}\)/);
  assert.match(activity, /onDataChanged\?\.\(\{ kind: 'sync' \}\)/);
  assert.match(activity, /new Set\(\['succeeded', 'incomplete', 'failed'\]\)/);
});

test('task completion refreshes both the searched jobs list and dashboard snapshot', async () => {
  const tasks = await readSource('hooks/useTasks.ts');
  const app = await readSource('hooks/useBossSpider.ts');

  assert.match(tasks, /await Promise\.allSettled\(\[refreshJobs\(\), refreshDashboardJobs\(\)\]\)/);
  assert.match(app, /refreshDashboardJobs,\n    requestBody/);
});

test('account activity checks the selected profile login state and guards browser actions', async () => {
  const activity = await readSource('pages/AccountActivity.tsx');
  const app = await readSource('App.tsx');

  assert.match(activity, /bossApi\.getLoginState\(profileProject\)/);
  assert.match(activity, /loginState\?\.canSchedule/);
  assert.match(activity, /登录已失效\/未保存 Cookie/);
  assert.match(activity, /onOpenLoginSettings/);
  assert.match(activity, /taskRunning/);
  assert.match(activity, /disabled=\{browserActionsDisabled\}/);
  assert.match(app, /onOpenLoginSettings=\{\(\) => navigateToTab\('Settings'\)\}/);
  assert.match(app, /taskRunning=\{boss\.isRunning\}/);
});
