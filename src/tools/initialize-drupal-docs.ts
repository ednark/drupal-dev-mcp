import { spawn } from 'child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDbReady, refreshDbStatus } from '../lib/lancedb.js';
import type { DbStatus } from '../lib/lancedb.js';

// Resolve the package root (two levels up from src/tools/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '../..');

// ── Tool Definition ──────────────────────────────────────────
export const INITIALIZE_DRUPAL_DOCS_TOOL = {
  name: 'initialize_drupal_docs',
  description: 'Initialize or rebuild the Drupal documentation database. Run this when the database is missing or needs to be refreshed. Without confirm=true, returns a status report and cost estimate. With confirm=true, runs the full ETL pipeline (fetches sources, parses, embeds, and loads into the vector database). This costs approximately $0.03 in OpenAI API usage.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      confirm: {
        type: 'boolean',
        description: 'Set to true to actually run the ETL pipeline. Without this, only returns current DB status and cost estimate.',
      },
      skip_fetch: {
        type: 'boolean',
        default: true,
        description: 'Set to true to skip fetching sources from the internet and only use existing local source data. Faster but may have less content.',
      },
    },
    required: [],
  },
};

// ── Status Report Formatter ──────────────────────────────────

function formatStatusReport(status: DbStatus): string {
  const lines: string[] = [];

  lines.push('## Drupal Docs Database Status\n');

  if (status.ready) {
    lines.push('✅ **Database is ready** — all required tables present and populated.\n');
  } else {
    lines.push('❌ **Database is NOT ready** — missing or empty tables detected.\n');
  }

  if (Object.keys(status.tableCounts).length > 0) {
    lines.push('### Tables Found\n');
    lines.push(`- **Total rows**: ${status.totalRows.toLocaleString()}`);
    for (const [tableName, rowCount] of Object.entries(status.tableCounts)) {
      lines.push(`- \`${tableName}\`: ${rowCount.toLocaleString()} rows`);
    }
    lines.push('');
  }

  if (status.tablesMissing.length > 0) {
    lines.push('### Missing or Empty Tables\n');
    for (const tableName of status.tablesMissing) {
      lines.push(`- \`${tableName}\``);
    }
    lines.push('');
  }

  lines.push('### Cost Estimate\n');
  lines.push('- Estimated cost: **~$0.03** for ~40K chunks (OpenAI embedding API)');
  lines.push('- This is a one-time cost per full ETL run.\n');

  lines.push('### Next Steps\n');
  lines.push('Call this tool again with `confirm=true` to run the ETL pipeline and build the database.');
  lines.push('Optionally pass `skip_fetch=true` to reuse existing local source data (faster, but may have less content).');

  return lines.join('\n');
}

function formatSuccessReport(status: DbStatus, stdoutTail: string): string {
  const lines: string[] = [];

  lines.push('## ETL Pipeline Complete ✅\n');
  lines.push('The Drupal documentation database has been successfully built.\n');

  if (Object.keys(status.tableCounts).length > 0) {
    lines.push('### Tables Loaded\n');
    lines.push(`- **Total rows**: ${status.totalRows.toLocaleString()}`);
    for (const [tableName, rowCount] of Object.entries(status.tableCounts)) {
      lines.push(`- \`${tableName}\`: ${rowCount.toLocaleString()} rows`);
    }
    lines.push('');
  }

  if (status.tablesMissing.length > 0) {
    lines.push('### Tables Still Missing\n');
    for (const tableName of status.tablesMissing) {
      lines.push(`- \`${tableName}\``);
    }
    lines.push('');
  }

  if (stdoutTail.trim().length > 0) {
    lines.push('### ETL Output (last 50 lines)\n');
    lines.push('```');
    lines.push(stdoutTail.trim());
    lines.push('```');
  }

  return lines.join('\n');
}

function formatErrorReport(stderr: string): string {
  const lines: string[] = [];

  lines.push('## ETL Pipeline Failed ❌\n');
  lines.push('The ETL pipeline exited with a non-zero status code.\n');

  if (stderr.trim().length > 0) {
    lines.push('### Error Output (last 50 lines)\n');
    lines.push('```');
    lines.push(stderr.trim());
    lines.push('```');
  }

  lines.push('\n### Suggested Diagnostics\n');
  lines.push('- Check that `OPENAI_API_KEY` is set in your environment.');
  lines.push('- Ensure network access is available for fetching sources.');
  lines.push('- Try running with `skip_fetch=true` if sources are already downloaded.');
  lines.push('- Run `npx tsx etl/run.ts` manually to see full output.');

  return lines.join('\n');
}

function tailLines(text: string, n: number): string {
  const allLines = text.split('\n');
  return allLines.slice(-n).join('\n');
}

// ── ETL subprocess runner ────────────────────────────────────

function runEtl(skipFetch: boolean): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const args = ['tsx', 'etl/run.ts'];
    if (skipFetch) args.push('--skip-fetch');

    const child = spawn('npx', args, {
      cwd: PACKAGE_ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      // Forward to server's stderr with prefix for real-time monitoring
      process.stderr.write(`[etl] ${text}`);
    });

    child.on('error', reject);

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

// ── Handler ──────────────────────────────────────────────────

export async function handleInitializeDrupalDocs(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const confirm = args.confirm === true;
    const skipFetch = args.skip_fetch === true;

    // ── Status / Dry-run Mode ────────────────────────────────
    if (!confirm) {
      console.error('[initialize_drupal_docs] Running in status/dry-run mode...');
      // Use refreshDbStatus() (not checkDbReady()) so the in-process
      // isDbReady() cache is updated even on a dry-run call.  This means
      // simply calling this tool without confirm=true is enough to "unlock"
      // the search tools when the DB is already populated on-disk.
      const status = await refreshDbStatus();
      const report = formatStatusReport(status);
      return {
        content: [{ type: 'text', text: report }],
      };
    }

    // ── ETL Execution Mode ───────────────────────────────────
    console.error('[initialize_drupal_docs] Starting ETL pipeline...');

    if (skipFetch) {
      console.error('[initialize_drupal_docs] skip_fetch=true — skipping source fetch step');
    }

    const result = await runEtl(!!args.skip_fetch);

    // Refresh cached DB status after ETL completes
    const updatedStatus = await refreshDbStatus();

    if (result.exitCode === 0) {
      console.error('[initialize_drupal_docs] ETL pipeline completed successfully');
      const stdoutTail = result.stdout ? tailLines(result.stdout, 50) : '';
      const report = formatSuccessReport(updatedStatus, stdoutTail);
      return {
        content: [{ type: 'text', text: report }],
      };
    } else {
      console.error(`[initialize_drupal_docs] ETL pipeline failed with exit code ${result.exitCode}`);
      const stderrTail = result.stderr ? tailLines(result.stderr, 50) : '';
      const report = formatErrorReport(stderrTail);
      return {
        content: [{ type: 'text', text: report }],
        isError: true,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[initialize_drupal_docs] Unexpected error: ${message}`);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
