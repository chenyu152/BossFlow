import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseAccountProfileProject, chooseInitialProject } from '../src/projectSelection.js';

test('does not invent agent when the workspace has no projects', () => {
  assert.equal(chooseInitialProject([], 'agent', 'agent'), '');
});

test('migrates an invalid remembered agent to the real default project', () => {
  assert.equal(
    chooseInitialProject(['Agent应用开发', '法务'], 'Agent应用开发', 'agent'),
    'Agent应用开发',
  );
});

test('keeps a valid account profile when the matching target changes', () => {
  assert.equal(
    chooseAccountProfileProject(['Agent应用开发', '法务'], '法务', 'Agent应用开发'),
    'Agent应用开发',
  );
});

test('does not return an invalid profile before the active project is ready', () => {
  assert.equal(chooseAccountProfileProject(['Agent应用开发', '法务'], '', 'agent'), '');
});
