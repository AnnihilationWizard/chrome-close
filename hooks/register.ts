import type { EngineInterface, Hook, Register } from 'claude-code'

// A shell command (Bash, or PowerShell on Windows) that may start a headless
// Chrome: a direct launch or a browser-automation tool. A bare "chrome" is not
// enough: paths and messages that only mention Chrome must not be held up by
// leftovers.
const LAUNCH = /--headless|puppeteer|playwright|headless[_-]shell|lighthouse|selenium|chromedp|webdriver/i

// Commands that only look at or end processes: they stay allowed so the
// leftovers can be cleaned up.
const INSPECT_OR_KILL =
  /^\s*(sudo\s+)?(kill|pkill|killall|ps|pgrep|lsof|top|htop|taskkill|tasklist|stop-process|get-process|get-ciminstance|get-wmiobject)\b/i

const CHROME = /chrom(e|ium)|headless[_-]shell/i

export type Proc = { pid: number; ppid: number; command: string }

// Lines of `pid ppid command`, from `ps` or from the PowerShell listing
// below (whose lines end in CRLF).
export const parsePs = (stdout: string): Proc[] =>
  stdout.split(/\r?\n/).flatMap(line => {
    const m = /^\s*(\d+)\s+(\d+)\s*(.*)$/.exec(line)
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] ?? '' }] : []
  })

// Whether the executable itself is Chrome: the text before the first option,
// so a shell running `chrome --headless ...` as `zsh -c ...` is not counted.
const isChrome = (command: string) => CHROME.test(command.split(/\s-/, 1)[0] ?? '')

// Headless Chrome processes: each browser started with --headless, every
// process beneath one, and Chrome helpers orphaned after their browser exited
// while they kept running: re-parented to launchd/init, or on Windows left
// with a parent that no longer exists. A normal Chrome's helpers keep their
// browser as parent, so they are not counted.
export const headlessChrome = (procs: readonly Proc[]): Proc[] => {
  const pids = new Set(procs.map(p => p.pid))
  const roots = procs.filter(
    p =>
      isChrome(p.command) &&
      (/\s--headless(=|\s|$)/.test(p.command) ||
        ((p.ppid === 1 || !pids.has(p.ppid)) && /\s--type=(?!crashpad-handler)/.test(p.command))),
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

// How processes are listed: `ps` on macOS and Linux; on Windows, where `ps`
// is missing or is Git Bash's (no -x), PowerShell's Win32_Process.
export const PS: readonly string[] = ['ps', '-axww', '-o', 'pid=,ppid=,command=']
export const CIM: readonly string[] = [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }',
]

// The listing that worked last, tried first next time.
let lister: readonly string[] | undefined

const list = async ($: EngineInterface, argv: readonly string[]): Promise<Proc[] | undefined> => {
  try {
    const { exitCode, stdout } = await $.process.run(argv)
    const procs = exitCode === 0 ? parsePs(stdout) : []
    return procs.length > 0 ? procs : undefined
  } catch {
    return undefined
  }
}

// The headless Chrome processes running, or undefined when no listing works.
const running = async ($: EngineInterface): Promise<Proc[] | undefined> => {
  for (const argv of lister === undefined ? [PS, CIM] : [lister, lister === PS ? CIM : PS]) {
    const procs = await list($, argv)
    if (procs !== undefined) {
      lister = argv
      return headlessChrome(procs)
    }
  }
  return undefined
}

// The command that ends them, in the shell whose listing found them.
const killHint = (procs: readonly Proc[]) =>
  lister === CIM
    ? `Stop-Process -Id ${procs.map(p => p.pid).join(',')} -Force`
    : `kill ${procs.map(p => p.pid).join(' ')}`

const describe = (procs: readonly Proc[]) =>
  `${procs.length} headless Chrome process(es) still running (PID ${procs
    .map(p => p.pid)
    .join(' ')})`

const KILL = /^\s*(sudo\s+)?(kill|pkill|killall|taskkill|stop-process)\b/i

const plural = (n: number) => `${n} headless Chrome process${n === 1 ? '' : 'es'}`

const UNCHECKED = 'cannot list processes; launches are not checked'

// Whether this plugin's status line shows a count, so a later kill clears it.
let isShowing = false

const show = ($: EngineInterface, text: string | undefined) => {
  $.ui.status(text)
  isShowing = text !== undefined
}

// The shells whose commands are checked. PowerShell is Claude Code's shell
// tool on Windows; it is not in every build's tool types, so it is matched
// by name here rather than by a typed matcher.
const SHELLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell'])

// One hook for Bash and PowerShell: both carry the command as `command`.
const guard: Hook<'tool.call'> = async ($, e, next) => {
  if (!SHELLS.has(e.tool)) return next(e)
  const { command, run_in_background } = e as { command?: unknown; run_in_background?: unknown }
  if (typeof command !== 'string') return next(e)
  if (KILL.test(command)) {
    const ran = await next(e)
    if (isShowing) {
      const left = (await running($)) ?? []
      show($, left.length > 0 ? `${plural(left.length)} left` : undefined)
    }
    return ran
  }
  if (!LAUNCH.test(command) || INSPECT_OR_KILL.test(command)) return next(e)

  const before = await running($)
  if (before === undefined) {
    // A failed check must not block the shell, but it must not pass unseen.
    show($, UNCHECKED)
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    return {
      ...ran,
      context: [
        ...(ran.context ?? []),
        `${$.plugin.name}: could not list processes (neither \`ps -axww\` nor PowerShell's Win32_Process worked), ` +
          `so this launch was not checked against other headless Chrome processes.`,
      ],
    }
  }
  if (before.length > 0) {
    show($, `${plural(before.length)} running`)
    return {
      deny:
        `${$.plugin.name}: only one headless Chrome may run at a time, and ${describe(before)}. ` +
        `Wait for it to finish, or end the leftovers first: ${killHint(before)} ` +
        `(the whole process group, not only the browser's main process), then run this again.`,
    }
  }

  const ran = await next(e)
  if (ran.deny !== undefined || run_in_background === true) return ran

  // A command that outran its timeout, or that the person backgrounded, is
  // still running: its Chrome is not a leftover yet.
  const isBackgrounded =
    ran.isError !== true &&
    typeof (ran.result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId === 'string'

  const after = (await running($)) ?? []
  show($, after.length === 0 ? undefined : `${plural(after.length)} ${isBackgrounded ? 'running' : 'left'}`)
  if (after.length === 0) return ran
  return {
    ...ran,
    context: [
      ...(ran.context ?? []),
      isBackgrounded
        ? `${$.plugin.name}: this command moved to the background and is still running, with ${describe(after)}. ` +
          `The next headless Chrome launch is refused until they end; if the command hangs, ${killHint(after)}.`
        : `${$.plugin.name}: this command finished but left ${describe(after)}. ` +
          `End them (${killHint(after)}) before starting another headless Chrome; ` +
          `the next launch is refused while any remain.`,
    ],
  }
}

export const register: Register = on => {
  // A hook that throws must not block the shell: fall through to the command.
  on('tool.call', guard).catch(($, e, next) => next(e))
}
