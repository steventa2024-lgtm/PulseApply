/**
 * Explicit, ordered schema migrations. Never edit a migration that has shipped;
 * append a new one instead.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE secrets (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        encrypted INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        sensitive TEXT,
        sensitive_encrypted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE resumes (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        file_name TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        format TEXT NOT NULL,
        text_length INTEGER NOT NULL,
        needs_ocr INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        parsed_at TEXT NOT NULL,
        warnings TEXT NOT NULL DEFAULT '[]',
        raw_text TEXT NOT NULL DEFAULT ''
      );
      CREATE UNIQUE INDEX idx_resumes_sha ON resumes(candidate_id, sha256);

      CREATE TABLE candidate_skills (
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        canonical_id TEXT,
        source TEXT NOT NULL,
        confirmed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (candidate_id, name)
      );

      CREATE TABLE search_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        criteria TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        interval_minutes INTEGER NOT NULL,
        notify INTEGER NOT NULL DEFAULT 1,
        min_score_to_notify INTEGER NOT NULL DEFAULT 60,
        last_run_at TEXT,
        last_success_at TEXT,
        last_result_count INTEGER,
        last_new_count INTEGER,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_run_at TEXT,
        running_since TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE job_sources (
        provider_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE provider_health (
        provider_id TEXT PRIMARY KEY,
        last_success_at TEXT,
        last_error_at TEXT,
        last_error TEXT,
        last_count INTEGER,
        rate_limited_until TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE provider_cache (
        cache_key TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_provider_cache_exp ON provider_cache(expires_at);

      CREATE TABLE employers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ats_provider TEXT NOT NULL,
        board_id TEXT NOT NULL,
        careers_url TEXT,
        country TEXT,
        locations TEXT NOT NULL DEFAULT '[]',
        industry TEXT,
        status TEXT NOT NULL,
        status_detail TEXT,
        last_sync_at TEXT,
        job_count INTEGER,
        added_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (ats_provider, board_id)
      );

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        canonical_key TEXT NOT NULL,
        data TEXT NOT NULL,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        source TEXT NOT NULL,
        posted_at TEXT,
        discovered_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        verification_status TEXT NOT NULL,
        occupation_id TEXT,
        match_score INTEGER,
        match TEXT,
        relevance TEXT,
        geo TEXT,
        saved INTEGER NOT NULL DEFAULT 0,
        dismissed INTEGER NOT NULL DEFAULT 0,
        is_demo INTEGER NOT NULL DEFAULT 0,
        legacy INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_jobs_last_seen ON jobs(last_seen_at);
      CREATE INDEX idx_jobs_verification ON jobs(verification_status);
      CREATE INDEX idx_jobs_canonical ON jobs(canonical_key);
      CREATE INDEX idx_jobs_score ON jobs(match_score);

      CREATE TABLE job_source_records (
        provider_id TEXT NOT NULL,
        source_job_id TEXT NOT NULL,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        source_url TEXT NOT NULL,
        apply_url TEXT,
        employer_direct INTEGER NOT NULL DEFAULT 0,
        fetched_at TEXT NOT NULL,
        raw TEXT,
        PRIMARY KEY (provider_id, source_job_id)
      );
      CREATE INDEX idx_jsr_job ON job_source_records(job_id);

      CREATE TABLE job_embeddings (
        content_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        vector TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (content_hash, model)
      );

      CREATE TABLE search_seen_jobs (
        search_id TEXT NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        notified_at TEXT,
        PRIMARY KEY (search_id, job_id)
      );

      CREATE TABLE saved_jobs (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        saved_at TEXT NOT NULL,
        note TEXT
      );

      CREATE TABLE applications (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        state TEXT NOT NULL,
        adapter TEXT NOT NULL,
        source_url TEXT NOT NULL,
        apply_url TEXT,
        current_url TEXT,
        resume_id TEXT,
        data TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        origin TEXT NOT NULL,
        is_demo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_at TEXT,
        submitted_at TEXT
      );
      CREATE INDEX idx_applications_job ON applications(job_id);
      CREATE INDEX idx_applications_state ON applications(state);

      CREATE TABLE application_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        message TEXT NOT NULL
      );
      CREATE INDEX idx_app_events_app ON application_events(application_id);

      CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY,
        search_id TEXT,
        trigger TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        stats TEXT,
        error TEXT
      );
      CREATE INDEX idx_runs_search ON automation_runs(search_id, started_at);

      CREATE TABLE telegram_chats (
        chat_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        added_at TEXT
      );

      CREATE TABLE telegram_notifications (
        id TEXT PRIMARY KEY,
        search_id TEXT,
        chat_id TEXT NOT NULL,
        message_id INTEGER,
        job_ids TEXT NOT NULL,
        kind TEXT NOT NULL,
        sent_at TEXT NOT NULL
      );

      CREATE TABLE telegram_callbacks (
        token TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        job_id TEXT NOT NULL,
        notification_id TEXT,
        chat_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        result TEXT
      );

      CREATE TABLE geocode_cache (
        query TEXT PRIMARY KEY,
        result TEXT,
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: 'criteria-based eligibility, run membership, resume documents',
    sql: `
      ALTER TABLE jobs ADD COLUMN elig_status TEXT;
      ALTER TABLE jobs ADD COLUMN elig_reason TEXT;
      ALTER TABLE jobs ADD COLUMN elig TEXT;
      ALTER TABLE jobs ADD COLUMN elig_key TEXT;
      ALTER TABLE jobs ADD COLUMN last_run_id TEXT;
      CREATE INDEX idx_jobs_elig ON jobs(elig_status, match_score);

      CREATE TABLE search_run_jobs (
        run_id TEXT NOT NULL,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        is_new INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, job_id)
      );
      CREATE INDEX idx_run_jobs_job ON search_run_jobs(job_id);

      CREATE TABLE resume_documents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_master INTEGER NOT NULL DEFAULT 0,
        resume_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE resume_document_versions (
        document_id TEXT NOT NULL REFERENCES resume_documents(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (document_id, version)
      );
    `
  }
]
