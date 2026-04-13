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
