import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  openaiApiKey: z.string().min(1, 'OPENAI_API_KEY is required'),
  lancedbPath: z.string().default('./data/lancedb'),
  etlSourcesDir: z.string().default('./data/sources'),
  drupalCoreBranch: z.string().default('11.x'),
  logLevel: z.string().default('info'),
  debugQueries: z.boolean().default(false),
});

export type AppConfig = z.infer<typeof configSchema>;

export function validateConfig(): AppConfig {
  const result = configSchema.safeParse({
    openaiApiKey: process.env.OPENAI_API_KEY,
    lancedbPath: process.env.LANCEDB_PATH,
    etlSourcesDir: process.env.ETL_SOURCES_DIR,
    drupalCoreBranch: process.env.ETL_DRUPAL_CORE_BRANCH,
    logLevel: process.env.LOG_LEVEL,
    debugQueries: process.env.DEBUG_QUERIES === 'true',
  });

  if (!result.success) {
    console.error('❌ Configuration error:');
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}
