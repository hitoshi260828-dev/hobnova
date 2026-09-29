CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  company TEXT,
  name TEXT NOT NULL,
  website TEXT,
  email TEXT NOT NULL,
  budget TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  duplicate_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts (status);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts (created_at);
CREATE INDEX IF NOT EXISTS idx_contacts_duplicate_hash ON contacts (duplicate_hash);
