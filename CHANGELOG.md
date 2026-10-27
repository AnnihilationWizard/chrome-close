# Changelog

## [1.2.0] - 2026-10-27

- A headless Microsoft Edge counts like a headless Chrome, as Playwright runs Edge for `channel: 'msedge'`: `msedge.exe --headless`, `Microsoft Edge` on macOS, every process beneath it, and its helpers left without their browser. WebView2 (`msedgewebview2.exe`), the Edge that Teams, Widgets and other Windows apps embed, is not counted, and neither is a desktop Edge.
- In Git Bash on Windows, the refusal and the leftover note name `taskkill //F //PID ...` to end the processes. Before, they named `Stop-Process`, which Git Bash does not have. The doubled slashes keep MSYS from reading `/F` as a path. PowerShell still gets `Stop-Process -Id ... -Force`, and macOS and Linux `kill`.
- On Windows, processes are listed as UTF-8. Before, Windows PowerShell 5.1 wrote the listing in the OEM code page, such as cp950 on zh-TW, so command lines with non-ASCII paths came back garbled.

## [1.1.3] - 2026-10-13

- In PowerShell, `\` is a path character, not an escape. Before, `Get-ChildItem C:\dir\; node playwright-test.js` read `\;` as an escaped `;`, so the line stayed one read-only part and a second headless Chrome started while one ran; `Get-Content "C:\logs\"; npx playwright test` read `\"` as an escaped quote the same way.
- In Bash, a backtick is no longer read as an escape, so `` echo `date`; npx playwright test `` is checked.
- When a quote is left open, the command is also split without regard to quotes, so a stray quote cannot hide a launch.

## [1.1.2] - 2026-10-13

- A command is no longer split inside quotes, and in PowerShell a part that starts with a quoted string is output, not a launch. Before, `Stop-Process -Id ... -Force; Start-Sleep 2; "headless-shell left: $(...)"`, the mod's own suggested cleanup followed by a report, was refused while a headless Chrome ran.
- `find` with `-exec`, `-execdir`, `-ok` or `-okdir`, `git bisect run`, `git -c` and `rg --pre` count as launches when they name one, and `awk` and `sed` are no longer read-only. Before, `find . -name 'playwright-test.js' -exec node {} 0 \;` started a second headless Chrome while one ran.

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

[1.2.0]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.2.0
[1.1.3]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.1.3
[1.1.2]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.1.2
[1.1.1]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.1.1
[1.1.0]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.1.0
[1.0.1]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.0.1
[1.0.0]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.0.0
