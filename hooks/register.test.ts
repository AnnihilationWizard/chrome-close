import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { headlessChrome, parsePs } from './register'

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
