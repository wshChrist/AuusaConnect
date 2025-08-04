ALTER TABLE teams
  ALTER COLUMN parent_team_id TYPE bigint USING parent_team_id::bigint;

ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_parent_team_id_fkey;

ALTER TABLE teams
  ADD CONSTRAINT teams_parent_team_id_fkey
  FOREIGN KEY (parent_team_id)
  REFERENCES teams (id)
  ON DELETE CASCADE;
