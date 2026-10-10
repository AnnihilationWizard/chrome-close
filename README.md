# chrome-close

**One headless Chrome at a time.** When Claude runs a Bash command that may start a headless Chrome (`--headless`, Puppeteer, Playwright, Selenium, Lighthouse, ...), the mod first checks whether a headless Chrome, or Chrome helpers left behind by one, is still running. If so, the command is refused and Claude is told which PIDs to end.

## Why

A test script that closes only Chrome's main process leaves its renderer, GPU and utility helpers running. Each run adds more, and memory use climbs.

## What it does

- **Before a launch**: refuses it while any headless Chrome runs: a browser started with `--headless`, every process beneath it, and Chrome helpers orphaned to `launchd` after their browser exited. Your desktop Chrome is not counted.
- **After a launch**: if the command left headless Chrome processes behind, Claude is told to end them, and the status line shows how many remain.
- `kill`, `pkill`, `killall`, `ps`, `pgrep`, `lsof` always run, so leftovers can be cleaned up.
- If the process check itself fails, the command runs as usual.

## Limits

- It guards only commands Claude runs through Bash. Tests you run in another terminal, an IDE or CI are not limited.
- It does not kill anything itself. Leftovers keep their memory until someone ends them.
- It recognises a launch by keywords in the command. A command such as `npm test` that starts Chrome without saying so is not caught before it runs, though leftovers it leaves are reported afterwards.

## Install

```
/plugin marketplace add AnnihilationWizard/mods
/plugin install chrome-close@annihilationwizard-mods
```

## Development

```bash
claude plugin validate .
claude plugin test .
tsc -p .
```

## License

[MIT License](LICENSE).
