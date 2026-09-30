/** Included in the ordinary SQLite migration transaction and backup. */
export const LEARN_MIGRATION_SQL = `
  CREATE TABLE learn_sources (owner_subject TEXT NOT NULL, id TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)), PRIMARY KEY(owner_subject, id));
  CREATE TABLE learn_exams (owner_subject TEXT NOT NULL, id TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)), PRIMARY KEY(owner_subject, id));
  CREATE TABLE learn_topics (owner_subject TEXT NOT NULL, id TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)), PRIMARY KEY(owner_subject, id));
  CREATE TABLE learn_mastery (owner_subject TEXT NOT NULL, id TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)), PRIMARY KEY(owner_subject, id));
  CREATE TABLE learn_sessions (owner_subject TEXT NOT NULL, id TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)), PRIMARY KEY(owner_subject, id));
  CREATE TABLE learn_blocks (
    owner_subject TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT NOT NULL, sequence INTEGER NOT NULL,
    status TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)),
    PRIMARY KEY(owner_subject, id), UNIQUE(owner_subject, session_id, sequence),
    FOREIGN KEY(owner_subject, session_id) REFERENCES learn_sessions(owner_subject, id)
  );
  CREATE UNIQUE INDEX learn_one_open_block ON learn_blocks(owner_subject, session_id) WHERE status = 'open';
`;

const recordColumns = [["owner_subject", "TEXT", 1, 1], ["id", "TEXT", 1, 2], ["record_json", "TEXT", 1, 0]] as const;
export const LEARN_REQUIRED_TABLES = {
  learn_sources: recordColumns, learn_exams: recordColumns, learn_topics: recordColumns,
  learn_mastery: recordColumns, learn_sessions: recordColumns,
  learn_blocks: [["owner_subject", "TEXT", 1, 1], ["id", "TEXT", 1, 2], ["session_id", "TEXT", 1, 0],
    ["sequence", "INTEGER", 1, 0], ["status", "TEXT", 1, 0], ["record_json", "TEXT", 1, 0]],
} as const;
