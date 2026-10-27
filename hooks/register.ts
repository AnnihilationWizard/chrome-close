import type { EngineInterface, Hook, Register } from 'claude-code'

// A shell command (Bash, or PowerShell on Windows) that may start a headless
// Chrome: a direct launch or a browser-automation tool. A bare "chrome" is not
// enough: paths and messages that only mention Chrome must not be held up by
// leftovers.
const LAUNCH = /--headless|puppeteer|playwright|headless[_-]shell|lighthouse|selenium|chromedp|webdriver/i

// Commands that only look at or end processes, so the leftovers can be found
// and cleaned up, or only read files and text, so a search for "playwright"
// is not a launch. Matched against the first word of each part of a command.
const INSPECT_OR_KILL = new Set([
  'kill', 'pkill', 'killall', 'ps', 'pgrep', 'lsof', 'top', 'htop',
  'taskkill', 'tasklist', 'stop-process', 'get-process', 'get-ciminstance', 'get-wmiobject',
])
const READ_ONLY = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'ls', 'dir',
  'echo', 'printf', 'wc', 'sort', 'uniq', 'cut', 'jq', 'diff', 'file', 'stat', 'which', 'where',
  'git', 'findstr', 'get-content', 'gc', 'type', 'select-string', 'sls', 'get-childitem', 'gci', 'get-item',
  'test-path', 'where-object', '?', 'select-object', 'sort-object', 'measure-object', 'format-table',
  'format-list', 'out-string', 'write-output', 'write-host',
])

// The first word of a part of a command, lower-cased, without its folder or
// a Windows `.exe`, and past a `sudo`.
const firstWord = (part: string) => {
  const words = part.trim().replace(/^[({&\s]+/, '').split(/\s+/)
  const word = (words[0] === 'sudo' ? words[1] : words[0]) ?? ''
  return (word.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
}

// Options that make an otherwise read-only command run another command.
const RUNS_COMMANDS: Readonly<Record<string, RegExp>> = {
  find: /\s-(exec|execdir|ok|okdir)\b/,
  git: /\sbisect\s+run\b|\s-c\s/,
  rg: /\s--pre\b/,
}

const SEPARATORS = /\|\||&&|[;|\n]/

// The parts of a command, split at `;`, `&&`, `||`, `|` and line ends that
// are outside quotes, so a quoted message or a PowerShell `"... $(...; ...)"`
// stays one part. Bash escapes with `\`; PowerShell with a backtick, where
// `\` is a plain path character (`Get-ChildItem C:\dir\; node x.js`). A quote
// left open makes the reading doubtful, so the plain split is added to it.
export const parts = (command: string, shell = 'Bash'): string[] => {
  const escape = shell === 'PowerShell' ? '`' : '\\'
  const found: string[] = []
  let part = ''
  let quote: string | undefined
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote !== undefined) {
      part += c
      if (quote === '"' && c === escape && i + 1 < command.length) part += command[++i]
      else if (c === quote) quote = undefined
    } else if (c === escape && i + 1 < command.length) {
      // An escaped character neither quotes nor separates.
      part += c + command[++i]
    } else if (c === '"' || c === "'") {
      quote = c
      part += c
    } else if (c === ';' || c === '\n' || c === '|' || (c === '&' && command[i + 1] === '&')) {
      if (command[i + 1] === c) i++
      found.push(part)
      part = ''
    } else part += c
  }
  found.push(part)
  return quote === undefined ? found : [...found, ...command.split(SEPARATORS)]
}

const isLaunchPart = (part: string, shell: string) => {
  if (!LAUNCH.test(part)) return false
  // In PowerShell a statement that starts with a string only outputs it; a
  // quoted program is run with `&` in front.
  if (shell === 'PowerShell' && /^\s*["']/.test(part)) return false
  const word = firstWord(part)
  if (INSPECT_OR_KILL.has(word)) return false
  return !READ_ONLY.has(word) || (RUNS_COMMANDS[word]?.test(part) ?? false)
}

// Whether a command may start a headless Chrome: some part of it names a
// launch and is not a command that only inspects, ends processes or reads.
export const isLaunch = (command: string, shell = 'Bash') =>
  parts(command, shell).some(part => isLaunchPart(part, shell))

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

// The command that ends them, in the shell that ran the command: PowerShell's
// Stop-Process; on Windows, Git Bash, which has no Stop-Process and whose MSYS
// layer turns a `/F` argument into a path, so taskkill's options take `//`;
// elsewhere `kill`.
const killHint = (procs: readonly Proc[], shell: string) => {
  const pids = procs.map(p => p.pid)
  if (shell === 'PowerShell') return `Stop-Process -Id ${pids.join(',')} -Force`
  if (lister === CIM) return `taskkill //F ${pids.map(pid => `//PID ${pid}`).join(' ')}`
  return `kill ${pids.join(' ')}`
}

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
  const isLaunching = isLaunch(command, e.tool)
  if (!isLaunching && KILL.test(command)) {
    const ran = await next(e)
    if (isShowing) {
      const left = (await running($)) ?? []
      show($, left.length > 0 ? `${plural(left.length)} left` : undefined)
    }
    return ran
  }
  if (!isLaunching) return next(e)

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
        `Wait for it to finish, or end the leftovers first: ${killHint(before, e.tool)} ` +
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
          `The next headless Chrome launch is refused until they end; if the command hangs, ${killHint(after, e.tool)}.`
        : `${$.plugin.name}: this command finished but left ${describe(after)}. ` +
          `End them (${killHint(after, e.tool)}) before starting another headless Chrome; ` +
          `the next launch is refused while any remain.`,
    ],
  }
}

export const register: Register = on => {
  // A hook that throws must not block the shell: fall through to the command.
  on('tool.call', guard).catch(($, e, next) => next(e))
}
