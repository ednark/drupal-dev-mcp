import { buildInventory, scoreInventory } from '../src/lib/research-sources/index.js';

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const inventory = await buildInventory(rootDir);
  const bundle = scoreInventory(inventory);

  console.log(JSON.stringify({
    inventoryCount: inventory.items.length,
    assessmentCount: bundle.assessments.length,
    unmappedCount: inventory.unmappedArtifacts.length,
  }, null, 2));
}

main().catch((error) => {
  console.error('research-sources smoke test failed:', error);
  process.exit(1);
});

