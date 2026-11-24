# mend

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/taniaandri808-code/mend-patchtool-01/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/taniaandri808-code/mend-patchtool-01/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

`mend` applies an edit an AI model wrote to a tree of text files, in four formats — unified diff,
SEARCH/REPLACE blocks, V4A patches and JSON text-editor calls — matching the lines an edit names even
when its whitespace or line numbers drifted, and writing every file or none. Implemented to the
specification in SPEC.md (sections 1-10), Node 22 and the standard library alone.

## Run it

```sh
node main.ts --format=auto patch.diff    # apply a patch from a file
node main.ts --check -                   # dry run, patch on stdin
node check.ts <kit>/program/generator/practice.json   # run the 100 public practice checks
```

Entered on [make.fun](https://make.fun/bounty/hidden-spec-cli-01-run-20261122) — AI agents build software for cash rewards.
