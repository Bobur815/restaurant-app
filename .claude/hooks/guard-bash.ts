// PreToolUse (Bash | PowerShell): hard-blocks commands that must never run from an agent session.
// Fails closed if the hook input cannot be parsed. Ported from posgro, minus its server rules.
import { block, readHookInput } from './_lib.ts';

interface Input {
  tool_input?: { command?: string };
}

const input = readHookInput<Input>();
if (!input) block('guard-bash: could not parse hook input; blocking to be safe.');

const cmd = input?.tool_input?.command ?? '';

interface Rule {
  re: RegExp;
  why: string;
}

// The till's real data: %APPDATA%\SavdoChef (database, backups, pictures, logs).
const REAL_DATA = String.raw`(appdata[\\/]+roaming|%appdata%|\$appdata|\$env:appdata)[\\/]+savdochef`;

const rules: Rule[] = [
  // Destructive SQL
  { re: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA|COLUMN|TRIGGER|INDEX)\b/i, why: 'destructive SQL (DROP/TRUNCATE)' },
  { re: /\bALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/i, why: 'ALTER TABLE ... DROP COLUMN' },
  { re: /\bDELETE\s+FROM\s+["\w.]+\s*(;|"|'|$)/i, why: 'DELETE FROM without WHERE' },

  // Prisma data-loss tooling (the app migrates its own databases; see skill prisma-migration)
  { re: /\bprisma\s+migrate\s+(reset|dev|deploy)\b/i, why: 'prisma migrate (SavdoChef uses src/main/database/migrations)' },
  { re: /\bprisma\s+db\s+(push|execute)\b/i, why: 'prisma db push/execute' },
  { re: /(--force-reset|--accept-data-loss)/, why: 'Prisma data-loss flag' },

  // The real database and its backups
  {
    re: new RegExp(String.raw`\b(rm|del|erase|rd|rmdir|mv|move|Remove-Item|Move-Item|ri)\b[^\n]*` + REAL_DATA, 'i'),
    why: 'deleting or moving the real SavdoChef data folder',
  },
  { re: new RegExp(String.raw`\bsqlite3?\b[^\n]*` + REAL_DATA, 'i'), why: 'opening the real database with a SQL shell' },

  // Git
  { re: /\bgit\s+push\b[^\n]*(--force|\s-f\b)/i, why: 'force push' },
  { re: /\bgit\s+reset\s+--hard\b/i, why: 'git reset --hard' },
  { re: /\bgit\s+clean\b[^\n]*-[a-z]*f/i, why: 'git clean -f' },
  // Extension must end the name: `schema.sqlite.prisma` is not a database.
  { re: /\bgit\s+add\b[^\n]*\.(db|sqlite|db-wal|db-shm)(?=$|[\s"'])/im, why: 'staging a database file' },
  { re: /\bgit\s+add\b[^\n]*(^|[\s/])\.env\b/i, why: 'staging .env' },

  // Filesystem wipes (bash + Windows)
  { re: /\brm\s+-[a-z]*(rf|fr)[a-z]*\b/i, why: 'rm -rf' },
  { re: /Remove-Item\b[^\n]*-Recurse/i, why: 'Remove-Item -Recurse' },
  { re: /\b(rd|rmdir)\s+\/s\b/i, why: 'rd /s' },
  { re: /\bdel\s+\/[sq]\b/i, why: 'del /s or /q' },
];

for (const { re, why } of rules) {
  if (re.test(cmd)) {
    block(
      `BLOCKED by .claude/hooks/guard-bash.ts: ${why}.\n` +
        `Ask the user and let them run it themselves if it is truly intended.`,
    );
  }
}
