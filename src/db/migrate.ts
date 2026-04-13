export const initialMigrationSql = `
CREATE TABLE IF NOT EXISTS farmers (
	id TEXT PRIMARY KEY,
	phone TEXT,
	name TEXT,
	location TEXT,
	crops TEXT,
	created_at INTEGER,
	last_active INTEGER
);

CREATE TABLE IF NOT EXISTS price_cache (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	data TEXT,
	fetched_at INTEGER
);
`;
