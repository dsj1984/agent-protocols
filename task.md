# Clean Code Refactoring Tasks

- [ ] Refactor `.agents/scripts/generate-playbook.js`
  - [ ] Extract `segregateTasks` helper
  - [ ] Extract `groupRegularTasks` helper
  - [ ] Extract `appendBookendSessions` helper
  - [ ] Replace `groupIntoChatSessions` with orchestrator call
- [ ] Refactor `tests/generate-playbook.test.js`
  - [ ] Create `makeBookendTasks` helper
  - [ ] Refactor integration tests to use the helper
- [ ] Refactor `tests/structure.test.js`
  - [ ] Rename `d` to `dirent`
  - [ ] Rename `f` to `filename`
- [ ] Verify Changes
  - [ ] Run `npm test`
  - [ ] Run `node .agents/scripts/generate-playbook.js 40`
