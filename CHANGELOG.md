# Changelog

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

[1.0.1]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.0.1
[1.0.0]: https://github.com/AnnihilationWizard/chrome-close/releases/tag/v1.0.0
