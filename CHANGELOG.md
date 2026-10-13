# Changelog

## [1.1.1] - 2026-10-13

- Reading or searching no longer counts as a launch. A command is split at `;`, `&&`, `||`, `|` and line ends, and a part that starts with a read-only command (`cat`, `grep`, `git`, `Get-Content`, `Select-String`, `Where-Object`, ...) or a process command is skipped. Before, `Get-Content out.txt; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ms-playwright' }` was refused while a headless Chrome ran, because the line contained "playwright" and its first word was not on the allow list.
- A launch after a cleanup command in the same line, such as `kill 901; chrome --headless`, is now checked instead of passing as a cleanup.

## [1.1.0] - 2026-10-13

- Works on Windows: when `ps -axww` is missing or is Git Bash's, which rejects `-x`, processes are listed through PowerShell's `Get-CimInstance Win32_Process`. Before, the check failed silently and every launch was allowed.
- Checks commands Claude runs with the `PowerShell` tool as well as `Bash`.
- On Windows, the refusal names `Stop-Process -Id ... -Force` to end the processes, and `taskkill`, `tasklist`, `Stop-Process`, `Get-Process`, `Get-CimInstance` and `Get-WmiObject` are never refused.
- Chrome helpers whose browser no longer exists count as leftovers on Windows, where they are not re-parented.
- When no process listing works, the launch still runs, but the status line reads `cannot list processes; launches are not checked` and Claude is told the launch was not checked.

## [1.0.1] - 2026-10-10

- A shell that launched Chrome (`zsh -c "chrome --headless ..."`) is no longer counted as a headless Chrome process.
- A command that outran its timeout or was moved to the background is reported as still running, not as finished.
- The status line no longer repeats the plugin name (`chrome-close: chrome-close: ...`), reads `N headless Chrome processes running` or `left`, and clears after a `kill` ends them.
- README illustration of a session before and after.

## [1.0.0] - 2026-10-10

Initial release of chrome-close by AnnihilationWizard.

- Refuses a Bash command that may start a headless Chrome (`--headless`, `headless-shell`, Puppeteer, Playwright, Selenium, Lighthouse, chromedp, WebDriver) while another headless Chrome runs.
- Counts a headless browser, every process beneath it, and Chrome helpers orphaned after their browser exited; a desktop Chrome is not counted.
- Names the PIDs to end in the refusal, and tells Claude when a finished command left headless Chrome processes behind.
- Shows the number of remaining headless Chrome processes on the status line.
- Never refuses `kill`, `pkill`, `killall`, `ps`, `pgrep`, `lsof`, `top` or `htop`, and lets commands that only mention Chrome run.
- Runs the command unchecked when the process check fails.
- Marketplace file so the repository installs with `/plugin install chrome-close --marketplace AnnihilationWizard/chrome-close`.
- Tests for detection, refusal, cleanup commands and leftover reports, run with `claude plugin test`.

Built on Claude Code's early-access function-hooks mod API.

[1.1.1]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.1.1
[1.1.0]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.1.0
[1.0.1]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.0.1
[1.0.0]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.0.0
