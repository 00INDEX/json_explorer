import { spawn } from 'child_process';

export interface JqOptions {
  jqPath: string;
  rawOutput: boolean;
  extraArgs: string[];
}

export interface JqResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run jq with `filter` against `input` (piped via stdin) and return the result.
 * Rejects only when jq cannot be spawned (e.g. binary not found); a non-zero
 * exit (a jq syntax/eval error) resolves with the captured stderr so the caller
 * can surface it to the user.
 */
export function runJq(filter: string, input: string, opts: JqOptions): Promise<JqResult> {
  const args = [...opts.extraArgs];
  if (opts.rawOutput) args.push('-r');
  args.push(filter);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(opts.jqPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `Could not find jq at "${opts.jqPath}". Install jq or set "jsonNotebook.jqPath" in settings.`
          )
        );
      } else {
        reject(err);
      }
    });

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    child.stdin.on('error', () => {
      /* ignore EPIPE when jq exits early */
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}
