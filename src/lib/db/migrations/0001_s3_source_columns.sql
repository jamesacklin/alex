ALTER TABLE books ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
--> statement-breakpoint
ALTER TABLE books ADD COLUMN s3_bucket TEXT;
--> statement-breakpoint
ALTER TABLE books ADD COLUMN s3_etag TEXT;
