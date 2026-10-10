import type { EngineInterface, Register } from 'claude-code'

// A Bash command that may start a headless Chrome: a direct launch or a
// browser-automation tool. A bare "chrome" is not enough: paths and messages
// that only mention Chrome must not be held up by leftovers.
const LAUNCH = /--headless|puppeteer|playwright|headless[_-]shell|lighthouse|selenium|chromedp|webdriver/i

// Commands that only look at or end processes: they stay allowed so the
// leftovers can be cleaned up.
const INSPECT_OR_KILL = /^\s*(sudo\s+)?(kill|pkill|killall|ps|pgrep|lsof|top|htop)\b/

const CHROME = /chrom(e|ium)|headless[_-]shell/i

export type Proc = { pid: number; ppid: number; command: string }

export const parsePs = (stdout: string): Proc[] =>
  stdout.split('\n').flatMap(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] ?? '' }] : []
  })

// Whether the executable itself is Chrome: the text before the first option,
// so a shell running `chrome --headless ...` as `zsh -c ...` is not counted.
const isChrome = (command: string) => CHROME.test(command.split(/\s-/, 1)[0] ?? '')

// Headless Chrome processes: each browser started with --headless, every
// process beneath one, and Chrome helpers orphaned to launchd/init (a browser
// that exited while its helpers kept running). A normal Chrome's helpers keep
// their browser as parent, so they are not counted.
export const headlessChrome = (procs: readonly Proc[]): Proc[] => {
  const roots = procs.filter(
    p =>
      isChrome(p.command) &&
      (/\s--headless(=|\s|$)/.test(p.command) ||
        (p.ppid === 1 && /\s--type=(?!crashpad-handler)/.test(p.command))),
  )
  const found = new Map(roots.map(p => [p.pid, p]))
  let grew = true
  while (grew) {
    grew = false
    for (const p of procs)
      if (!found.has(p.pid) && found.has(p.ppid)) {
        found.set(p.pid, p)
        grew = true
      }
  }
  return [...found.values()]
}

const running = async ($: EngineInterface): Promise<Proc[]> => {
  const { exitCode, stdout } = await $.process.run(['ps', '-axww', '-o', 'pid=,ppid=,command='])
  return exitCode === 0 ? headlessChrome(parsePs(stdout)) : []
}

const describe = (procs: readonly Proc[]) =>
  `${procs.length} headless Chrome process(es) still running (PID ${procs
    .map(p => p.pid)
    .join(' ')})`

const KILL = /^\s*(sudo\s+)?(kill|pkill|killall)\b/

const plural = (n: number) => `${n} headless Chrome process${n === 1 ? '' : 'es'}`

// Whether this plugin's status line shows a count, so a later kill clears it.
let isShowing = false

const show = ($: EngineInterface, text: string | undefined) => {
  $.ui.status(text)
  isShowing = text !== undefined
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = e.command
    if (KILL.test(command)) {
      const ran = await next(e)
      if (isShowing) {
        const left = await running($)
        show($, left.length > 0 ? `${plural(left.length)} left` : undefined)
      }
      return ran
    }
    if (!LAUNCH.test(command) || INSPECT_OR_KILL.test(command)) return next(e)

    const before = await running($)
    if (before.length > 0) {
      show($, `${plural(before.length)} running`)
      return {
        deny:
          `${$.plugin.name}: only one headless Chrome may run at a time, and ${describe(before)}. ` +
          `Wait for it to finish, or end the leftovers first: kill ${before.map(p => p.pid).join(' ')} ` +
          `(the whole process group, not only the browser's main process), then run this again.`,
      }
    }

    const ran = await next(e)
    if (ran.deny !== undefined || e.run_in_background === true) return ran

    // A command that outran its timeout, or that the person backgrounded, is
    // still running: its Chrome is not a leftover yet.
    const isBackgrounded =
      ran.isError !== true && typeof (ran.result as { backgroundTaskId?: unknown }).backgroundTaskId === 'string'

    const after = await running($)
    show($, after.length === 0 ? undefined : `${plural(after.length)} ${isBackgrounded ? 'running' : 'left'}`)
    if (after.length === 0) return ran
    const pids = after.map(p => p.pid).join(' ')
    return {
      ...ran,
      context: [
        ...(ran.context ?? []),
        isBackgrounded
          ? `${$.plugin.name}: this command moved to the background and is still running, with ${describe(after)}. ` +
            `The next headless Chrome launch is refused until they end; if the command hangs, kill ${pids}.`
          : `${$.plugin.name}: this command finished but left ${describe(after)}. ` +
            `Kill them (kill ${pids}) before starting another headless Chrome; ` +
            `the next launch is refused while any remain.`,
      ],
    }
  // A failed process check must not block Bash: fall through to the command.
  }).catch(($, e, next) => next(e))
}
