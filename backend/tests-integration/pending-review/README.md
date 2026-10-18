# Pending review (not run by `npm test` or `npm run test:db`)

`call-logs.db.copy-from-tests-folder.js` was found in `backend/tests/`, where `npm test` picked it up and failed 7 times without a database.
It is a second, DIFFERENT version of `tests-integration/call-logs.db.test.js`: it expects `uniqueLeadsCalled` to be 2 (an undone call's lead is
excluded) and asserts that the BDE summary and admin statistics agree, whereas the version in `tests-integration/` expects 3. Both need a real
development database, so neither could be run here. The two disagree about a counting rule, so neither was deleted or chosen.
Decide which is correct, run it with `npm run test:db`, and delete the other. The file is not named `*.test.js` so it is skipped until then.
