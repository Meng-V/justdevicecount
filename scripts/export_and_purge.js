require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function run() {
  const latest = await prisma.deviceData.findFirst({
    orderBy: { timeStamp: 'desc' },
    select: { timeStamp: true }
  });

  if (!latest) {
    console.log('No data in device_data. Nothing to export.');
    return;
  }

  const cutoff = latest.timeStamp;
  const where = { timeStamp: { lte: cutoff } };

  const totalCount = await prisma.deviceData.count({ where });
  if (totalCount === 0) {
    console.log('No rows to export.');
    return;
  }

  const outDir = path.resolve(__dirname, '..', 'stored data');
  fs.mkdirSync(outDir, { recursive: true });

  const cutoffStamp = cutoff.toISOString().replace(/[:]/g, '-');
  const runStamp = new Date().toISOString().replace(/[:]/g, '-');
  const filename = `device_data_export_until_${cutoffStamp}_run_${runStamp}.json`;
  const outPath = path.join(outDir, filename);
  const stream = fs.createWriteStream(outPath, { encoding: 'utf8' });

  stream.write('[');
  let first = true;
  const batchSize = 1000;
  let lastId = undefined;
  let exportedCount = 0;

  while (true) {
    const batch = await prisma.deviceData.findMany({
      where,
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(lastId ? { skip: 1, cursor: { id: lastId } } : {}),
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      const json = JSON.stringify(row);
      if (!first) stream.write(',\n');
      else first = false;
      stream.write(json);
    }

    exportedCount += batch.length;
    lastId = batch[batch.length - 1].id;
  }

  stream.write(']\n');
  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on('error', reject);
  });

  if (exportedCount !== totalCount) {
    throw new Error(`Export mismatch: exported ${exportedCount} but DB had ${totalCount}. Aborting delete.`);
  }

  if (process.argv.includes('--dry-run')) {
    console.log(`[DRY-RUN] Exported ${exportedCount} rows to ${outPath}. Skipping delete.`);
    return;
  }

  const deleteResult = await prisma.deviceData.deleteMany({ where });
  if (deleteResult.count !== totalCount) {
    throw new Error(`Delete mismatch: deleted ${deleteResult.count} but expected ${totalCount}.`);
  }

  console.log(`Exported and deleted ${totalCount} rows to ${outPath}`);
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
