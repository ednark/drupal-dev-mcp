import { buildToolInventory, scoreToolInventory } from '../src/lib/research-tools/index.js';

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const inventory = await buildToolInventory(rootDir);
  const bundle = scoreToolInventory(inventory);

  console.log(
    JSON.stringify(
      {
        toolCount: inventory.items.length,
        assessmentCount: bundle.assessments.length,
        duplicateToolCount: bundle.duplicates.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('research-tools smoke test failed:', error);
  process.exit(1);
});

