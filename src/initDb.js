const fs = require('node:fs/promises');
const path = require('node:path');
const { query } = require('./db');

async function initDb() {
  const schemaPath = path.resolve(__dirname, 'sql', 'schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf8');
  await query(schemaSql);
}

module.exports = { initDb };
