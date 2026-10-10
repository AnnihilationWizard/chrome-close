# Security Notes

chrome-close only decides whether Claude Code runs a Bash command that may start a headless Chrome. These notes describe what it can reach; they do not establish a support SLA.

## What the mod does

- It hooks `tool.call` for `Bash` and reads the command text Claude is about to run.
- When the command may start a headless Chrome, it runs `ps -axww -o pid=,ppid=,command=` as your user, before and after the command, to list running processes.
- It refuses the command or adds a note for Claude, and sets a status line entry.
- It does not end processes, read or write files, make network requests or change settings.

The `ps` output includes the full command line of every process you can see. The mod keeps only the PIDs of headless Chrome processes and puts them in the text Claude reads.

It is a guard for commands Claude runs, not a sandbox: a launch without a recognised keyword, or Chrome started outside Claude Code, is not stopped.

## Report a security concern

If this repository offers GitHub private vulnerability reporting, use the **Report a vulnerability** option on its [Security page](https://github.com/AnnihilationWizard/chrome-close/security). This document does not assume that the option is enabled.

If no private reporting option is available, open a minimal issue asking the maintainer to arrange a private channel. Do not publish exploit details, credentials or private code in that issue.

Include the affected version, Claude Code version, environment, steps to reproduce and impact. No response-time or supported-version guarantee is currently stated.
