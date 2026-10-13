import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { headlessChrome, isLaunch, parsePs, parts } from './register'

const CFT = '/Users/me/.cache/puppeteer/chrome/mac-131/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const HELPER = '/Users/me/.cache/puppeteer/chrome/mac-131/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Framework.framework/Helpers/Google Chrome for Testing Helper (Renderer).app/Contents/MacOS/Google Chrome for Testing Helper (Renderer)'
const DESKTOP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DESKTOP_HELPER = '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper'

const ps = (...rows: [number, number, string][]) => rows.map(([pid, ppid, c]) => `  ${pid}  ${ppid} ${c}`).join('\n')

const IDLE = ps([500, 1, DESKTOP], [501, 500, `${DESKTOP_HELPER} --type=gpu-process`], [77, 1, '/usr/bin/node app.js'])
const RUNNING = ps([500, 1, DESKTOP], [900, 880, `${CFT} --headless=new --remote-debugging-port=0`], [901, 900, `${HELPER} --type=renderer`])
const SHELL = '/bin/zsh -c source ~/.claude/shell-snapshots/snapshot.sh && eval \'"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new about:blank\''
const WRAPPED = ps([880, 70, SHELL], [900, 880, `${CFT} --headless=new --remote-debugging-port=0`], [901, 900, `${HELPER} --type=renderer`])
const ORPHANS = ps([500, 1, DESKTOP], [901, 1, `${HELPER} --type=renderer`], [902, 1, `${HELPER} --type=gpu-process`])

// The engine beneath: `ps` answers from a fixed table, and Bash records what ran.
// Returns the status lines the plugin pinned, in order.
const world = (on: On, table: () => string, ran: string[], after?: () => void, result: object = {}) => {
  const lines: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: table(), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    ran.push(e.command)
    after?.()
    return { result: { stdout: 'ok', stderr: '', interrupted: false, ...result } } as never
  })
  return lines
}

test('finds a headless browser and its helpers, not a desktop Chrome', () => {
  expect(headlessChrome(parsePs(IDLE))).toEqual([])
  expect(headlessChrome(parsePs(RUNNING)).map(p => p.pid).sort()).toEqual([900, 901])
})

test('does not count the shell that launched a headless Chrome', () => {
  expect(headlessChrome(parsePs(WRAPPED)).map(p => p.pid).sort()).toEqual([900, 901])
})

test('finds helpers orphaned after their headless browser exited', () => {
  expect(headlessChrome(parsePs(ORPHANS)).map(p => p.pid).sort()).toEqual([901, 902])
})

test('refuses a launch while a headless Chrome runs', async ($, on) => {
  const ran: string[] = []
  world(on, () => RUNNING, ran)
  const r = await $.tool.call({ tool: 'Bash', command: 'node shot.mjs --headless' })
  expect(r.deny).toMatch(/only one headless Chrome/)
  expect(r.deny).toMatch(/900 901/)
  expect(ran).toEqual([])
})

test('refuses a launch while orphaned helpers remain', async ($, on) => {
  const ran: string[] = []
  world(on, () => ORPHANS, ran)
  const r = await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  expect(r.deny).toMatch(/901 902/)
  expect(ran).toEqual([])
})

test('lets a launch run when none is running', async ($, on) => {
  const ran: string[] = []
  world(on, () => IDLE, ran)
  const r = await $.tool.call({ tool: 'Bash', command: 'node puppeteer-test.js' })
  expect(r.deny).toBeUndefined()
  expect(ran).toEqual(['node puppeteer-test.js'])
})

test('lets cleanup and unrelated commands run while one is running', async ($, on) => {
  const ran: string[] = []
  world(on, () => RUNNING, ran)
  await $.tool.call({ tool: 'Bash', command: 'pkill -f "Chrome for Testing"' })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(ran).toEqual(['pkill -f "Chrome for Testing"', 'git status'])
})

test('lets commands that only mention Chrome run while leftovers remain', async ($, on) => {
  const ran: string[] = []
  world(on, () => ORPHANS, ran)
  await $.tool.call({ tool: 'Bash', command: 'cd ~/mods/chrome-close && git commit -m "fix Chrome check"' })
  await $.tool.call({ tool: 'Bash', command: 'grep -ri chromium src' })
  expect(ran).toHaveLength(2)
})

test('tells Claude when a launch left processes behind', async ($, on) => {
  const ran: string[] = []
  let table = IDLE
  world(on, () => table, ran, () => { table = ORPHANS })
  const r = await $.tool.call({ tool: 'Bash', command: 'node puppeteer-test.js' })
  expect(r.deny).toBeUndefined()
  expect((r.context ?? []).join('\n')).toMatch(/left 2 headless Chrome process\(es\).*kill 901 902/s)
})

test('a failing process check does not block the command', async ($, on) => {
  const ran: string[] = []
  on('process.run', () => { throw new Error('ps unavailable') })
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    ran.push(e.command)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  await $.tool.call({ tool: 'Bash', command: 'node puppeteer-test.js' })
  expect(ran).toEqual(['node puppeteer-test.js'])
})

test('says a backgrounded command is still running, not finished', async ($, on) => {
  const ran: string[] = []
  let table = IDLE
  const lines = world(on, () => table, ran, () => { table = RUNNING }, { backgroundTaskId: 'b51a3ynq6' })
  const r = await $.tool.call({ tool: 'Bash', command: 'node puppeteer-test.js' })
  const note = (r.context ?? []).join('\n')
  expect(note).toMatch(/moved to the background and is still running/)
  expect(note).not.toMatch(/finished/)
  expect(lines.at(-1)).toBe('2 headless Chrome processes running')
})

test('status line names the count once, without the plugin name', async ($, on) => {
  const ran: string[] = []
  let table = IDLE
  const lines = world(on, () => table, ran, () => { table = ORPHANS })
  await $.tool.call({ tool: 'Bash', command: 'node puppeteer-test.js' })
  expect(lines.at(-1)).toBe('2 headless Chrome processes left')
})

test('a kill that ends the leftovers clears the status line', async ($, on) => {
  const ran: string[] = []
  let table = ORPHANS
  const lines = world(on, () => table, ran, () => { if (ran.at(-1)?.startsWith('kill')) table = IDLE })
  await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  expect(lines.at(-1)).toBe('2 headless Chrome processes running')
  await $.tool.call({ tool: 'Bash', command: 'kill 901 902' })
  expect(lines.at(-1)).toBeUndefined()
  expect(lines.length).toBe(2)
})

// Windows: Git Bash's `ps` rejects -x, so the listing comes from PowerShell's
// Win32_Process, one CRLF-ended `pid ppid command` line per process.
const WIN_CHROME = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'
const cim = (...rows: [number, number, string][]) => rows.map(([pid, ppid, c]) => `${pid} ${ppid} ${c}`).join('\r\n') + '\r\n'
const WIN_IDLE = cim([4, 0, ''], [6100, 5000, `${WIN_CHROME} --flag-switches-begin`], [6120, 6100, `${WIN_CHROME} --type=renderer`])
const WIN_RUNNING = cim(
  [4, 0, ''],
  [7000, 6900, 'pwsh.exe -NoProfile -Command "& chrome.exe --headless=new about:blank"'],
  [7010, 7000, `${WIN_CHROME} --headless=new --remote-debugging-port=0`],
  [7020, 7010, `${WIN_CHROME} --type=gpu-process`],
)
const WIN_ORPHANS = cim([4, 0, ''], [7020, 7010, `${WIN_CHROME} --type=gpu-process`], [7030, 7010, `${WIN_CHROME} --type=renderer`])

const OK = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// The engine beneath on Windows: `ps` fails as Git Bash's does, PowerShell
// lists from `table`, and both shells record what ran.
const windows = (on: On, table: () => string | undefined, ran: string[]) => {
  const lines: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const stdout = e.argv[0] === 'powershell.exe' ? table() : undefined
    return stdout === undefined
      ? { value: { ...OK, exitCode: 1, stdout: '', stderr: 'ps: unknown option -- x' } }
      : { value: { ...OK, exitCode: 0, stdout } }
  })
  on('tool.call', ($, e) => {
    ran.push(`${e.tool}: ${(e as { command?: string }).command}`)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  return lines
}

test('reads a Windows process listing with CRLF line ends', () => {
  expect(parsePs(WIN_RUNNING).map(p => p.pid)).toEqual([4, 7000, 7010, 7020])
  expect(headlessChrome(parsePs(WIN_IDLE))).toEqual([])
  expect(headlessChrome(parsePs(WIN_RUNNING)).map(p => p.pid).sort()).toEqual([7010, 7020])
})

test('finds Windows helpers whose browser no longer exists', () => {
  expect(headlessChrome(parsePs(WIN_ORPHANS)).map(p => p.pid).sort()).toEqual([7020, 7030])
})

test('on Windows, refuses a PowerShell launch while a headless Chrome runs', async ($, on) => {
  const ran: string[] = []
  windows(on, () => WIN_RUNNING, ran)
  const r = await $.tool.call({ tool: 'PowerShell', command: 'npx playwright test' } as never)
  expect(r.deny).toMatch(/only one headless Chrome/)
  expect(r.deny).toMatch(/Stop-Process -Id 7010,7020 -Force/)
  expect(ran).toEqual([])
})

test('on Windows, refuses a Bash launch too, listing through PowerShell', async ($, on) => {
  const ran: string[] = []
  windows(on, () => WIN_ORPHANS, ran)
  const r = await $.tool.call({ tool: 'Bash', command: 'node puppeteer-test.js' })
  expect(r.deny).toMatch(/7020 7030/)
  expect(ran).toEqual([])
})

test('lets PowerShell cleanup run while leftovers remain', async ($, on) => {
  const ran: string[] = []
  windows(on, () => WIN_ORPHANS, ran)
  await $.tool.call({ tool: 'PowerShell', command: 'Stop-Process -Id 7020,7030 -Force' } as never)
  await $.tool.call({ tool: 'PowerShell', command: "Get-CimInstance Win32_Process | ? CommandLine -match '--headless'" } as never)
  expect(ran).toHaveLength(2)
})

test('when no process listing works, runs the launch but says it was not checked', async ($, on) => {
  const ran: string[] = []
  const lines = windows(on, () => undefined, ran)
  const r = await $.tool.call({ tool: 'PowerShell', command: 'node puppeteer-test.js' } as never)
  expect(r.deny).toBeUndefined()
  expect(ran).toEqual(['PowerShell: node puppeteer-test.js'])
  expect((r.context ?? []).join('\n')).toMatch(/could not list processes/)
  expect(lines.at(-1)).toBe('cannot list processes; launches are not checked')
})

test('reads and searches that only mention a launch are not launches', () => {
  for (const command of [
    "Get-Content out.txt; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ms-playwright' } | Select-Object ProcessId",
    'Select-String playwright package.json',
    'cat playwright.config.ts',
    'grep -r puppeteer src | head',
    'ps aux | grep -- --headless',
    'git commit -m "test: run playwright headless"',
    'C:\\Windows\\System32\\findstr.exe /s playwright *.json',
  ])
    expect(isLaunch(command), command).toBe(false)
})

test('a launch is found in any part of a command', () => {
  for (const command of [
    'npx playwright test',
    'cat notes.txt; npx playwright test',
    'cd app && npx playwright test --project=chromium',
    'kill 901; chrome --headless=new about:blank',
    'sudo node puppeteer-test.js',
    'CI=1 npx playwright test',
    '& "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --headless=new --dump-dom about:blank',
  ])
    expect(isLaunch(command), command).toBe(true)
})

test('on Windows, a read-only search runs while a headless Chrome runs', async ($, on) => {
  const ran: string[] = []
  windows(on, () => WIN_RUNNING, ran)
  const read =
    "Get-Content out.txt; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ms-playwright' }"
  const r = await $.tool.call({ tool: 'PowerShell', command: read } as never)
  expect(r.deny).toBeUndefined()
  const launch = await $.tool.call({ tool: 'PowerShell', command: 'Get-Content out.txt; npx playwright test' } as never)
  expect(launch.deny).toMatch(/only one headless Chrome/)
  expect(ran).toEqual([`PowerShell: ${read}`])
})

test('splits a command outside quotes only', () => {
  expect(parts('a; b && c || d | e\nf').map(p => p.trim())).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  expect(parts(`git commit -m "fix; npx playwright test" && ls`).map(p => p.trim())).toEqual([
    'git commit -m "fix; npx playwright test"',
    'ls',
  ])
  expect(parts(`"left: $(Get-Process x; 1)"; done`).map(p => p.trim())).toEqual(['"left: $(Get-Process x; 1)"', 'done'])
  expect(parts(`echo \\"a; b`).map(p => p.trim())).toEqual(['echo \\"a', 'b'])
})

test('in PowerShell, a cleanup followed by a quoted report is not a launch', () => {
  const command =
    'Stop-Process -Id 39776,39780 -Force; Start-Sleep 2; "headless-shell left: $((Get-Process chrome-headless-shell -ErrorAction SilentlyContinue).Count)"'
  expect(isLaunch(command, 'PowerShell')).toBe(false)
  expect(isLaunch("'--headless is the flag'", 'PowerShell')).toBe(false)
  // A quoted program is run with `&` in PowerShell, and directly in Bash.
  expect(isLaunch('& "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --headless=new', 'PowerShell')).toBe(true)
  expect(isLaunch('"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new', 'Bash')).toBe(true)
})

test('read-only commands that run other commands are checked', () => {
  for (const command of [
    "find . -name 'playwright-test.js' -exec node {} 0 \\;",
    'find . -name "*.spec.ts" -execdir npx playwright test {} +',
    "find . -ok chrome --headless {} \\;",
    'git bisect run npx playwright test',
    'git -c alias.t="!npx playwright test" t',
    'rg --pre ./playwright-pre.sh pattern',
    "awk 'BEGIN { system(\"node playwright-test.js\") }'",
    "sed -n '1e npx playwright test' notes.txt",
  ])
    expect(isLaunch(command), command).toBe(true)
  for (const command of ["find . -name 'playwright*.ts'", 'git log --grep=playwright', 'rg playwright src'])
    expect(isLaunch(command), command).toBe(false)
})

test('on Windows, the suggested Stop-Process runs with a report after it', async ($, on) => {
  const ran: string[] = []
  windows(on, () => WIN_RUNNING, ran)
  const command = 'Stop-Process -Id 7010,7020 -Force; Start-Sleep 2; "headless-shell left: $(0)"'
  const r = await $.tool.call({ tool: 'PowerShell', command } as never)
  expect(r.deny).toBeUndefined()
  expect(ran).toEqual([`PowerShell: ${command}`])
})

test('in PowerShell, a backslash before a separator or quote is a path character', () => {
  const dir = 'Get-ChildItem C:\\work\\pw-fixture\\; node "C:\\work\\pw-fixture\\playwright-test.js" 0'
  expect(parts(dir, 'PowerShell').map(p => p.trim())).toEqual([
    'Get-ChildItem C:\\work\\pw-fixture\\',
    'node "C:\\work\\pw-fixture\\playwright-test.js" 0',
  ])
  expect(isLaunch(dir, 'PowerShell')).toBe(true)
  expect(isLaunch('Get-Content "C:\\logs\\"; npx playwright test', 'PowerShell')).toBe(true)
  // The backtick is PowerShell's escape: an escaped separator does not split.
  expect(parts('Write-Output a`;b', 'PowerShell')).toHaveLength(1)
})

test('in Bash, a backtick is not an escape', () => {
  expect(isLaunch('echo `date`; npx playwright test')).toBe(true)
})

test('a quote left open is also read without quotes', () => {
  expect(isLaunch('cat "notes.txt; npx playwright test')).toBe(true)
  expect(isLaunch("Get-Content 'a.txt; npx playwright test", 'PowerShell')).toBe(true)
})

test('on Windows, a path ending in a backslash does not hide a launch', async ($, on) => {
  const ran: string[] = []
  windows(on, () => WIN_RUNNING, ran)
  const r = await $.tool.call({
    tool: 'PowerShell',
    command: 'Get-ChildItem C:\\work\\pw-fixture\\; node "C:\\work\\pw-fixture\\playwright-test.js" 0',
  } as never)
  expect(r.deny).toMatch(/only one headless Chrome/)
  expect(ran).toEqual([])
})
