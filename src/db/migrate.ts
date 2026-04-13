export const initialMigrationSql = `
CREATE TABLE IF NOT EXISTS farmers (
	id TEXT PRIMARY KEY,
	phone TEXT,
	name TEXT,
	location TEXT,
	crops TEXT,
	onboarding_step TEXT,
	onboarding_completed INTEGER DEFAULT 0,
	created_at INTEGER,
	last_active INTEGER
);

CREATE TABLE IF NOT EXISTS price_cache (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	data TEXT,
	fetched_at INTEGER
);

CREATE TABLE IF NOT EXISTS diagnoses (
	id TEXT PRIMARY KEY,
	farmer_id TEXT,
	image_key TEXT,
	diagnosis TEXT,
	confidence TEXT,
	gemini_response TEXT,
	feedback_correct INTEGER,
	created_at INTEGER
);
`;
