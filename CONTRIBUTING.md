# Contributing

Thank you for helping improve chrome-close. It is a small Claude Code mod written as a plugin of function hooks. Start with the [README](README.md).

## Report a bug

Use the [issue tracker](https://github.com/AnnihilationWizard/chrome-close/issues). Include:

- The chrome-close version, Claude Code version (`claude --version`) and operating system.
- The command Claude ran, and whether it was refused or let through when you expected the other.
- The matching process lines for the Chrome processes involved, with private paths removed: `ps -axww -o pid=,ppid=,command=` on macOS and Linux, or on Windows `Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }` in PowerShell.
- The shell Claude used: Bash (and which one, such as Git Bash) or PowerShell.
- Any transcript line that names `chrome-close`.

Never paste source code, file contents or paths you are not allowed to share. For security concerns, follow [SECURITY.md](SECURITY.md).

## Propose a change

Open an issue that describes the problem and the intended behavior before a broad change. Keep changes focused: the mod should only decide whether a command runs and report what it found, never end processes itself.

## Develop and verify

Run from the repository root:

```bash
claude plugin validate .
claude plugin test .
npx -p typescript@5 tsc -p .
```

The type-check needs the types Claude Code writes to `.claude-plugin/types/` the first time it loads the mod, for example with `claude --plugin-dir .`.

For behavior changes, add or update a test in `hooks/register.test.ts`.

## Submit a pull request

- Explain the problem and the resulting behavior.
- List the checks you ran and their results.
- Update the README and CHANGELOG when behavior changes.
- Use a Conventional Commit message, such as `fix: count chrome-headless-shell helpers`.
