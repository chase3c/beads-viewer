export interface ParsedArgs {
  repositoryPath: string;
  port?: number;
  open: boolean;
  help: boolean;
}

export function parseArgs(args: string[], currentDirectory = process.cwd()): ParsedArgs {
  let repositoryPath: string | undefined;
  let port: number | undefined;
  let shouldOpen = true;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--open') shouldOpen = true;
    else if (arg === '--no-open') shouldOpen = false;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--port') {
      const value = Number(args[++index]);
      if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
        throw new Error('--port must be an integer between 0 and 65535');
      }
      port = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (repositoryPath) {
      throw new Error('Only one repository path may be supplied');
    } else {
      repositoryPath = arg;
    }
  }

  return { repositoryPath: repositoryPath ?? currentDirectory, port, open: shouldOpen, help };
}
