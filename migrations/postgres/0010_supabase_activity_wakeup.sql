-- Supabase Realtime is an optional wake-up accelerator only. The durable,
-- owner-authenticated cursor API remains authoritative. Install this read-only
-- broadcast policy only when the Supabase-managed schemas are present.
DO $jobbbler$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL
     AND to_regprocedure('realtime.topic()') IS NOT NULL
     AND to_regprocedure('auth.jwt()') IS NOT NULL
     AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL
  THEN
    IF NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'realtime'
         AND tablename = 'messages'
         AND policyname = 'jobbbler_owner_activity_wakeup_read'
    ) THEN
      EXECUTE $policy$
        CREATE POLICY jobbbler_owner_activity_wakeup_read
          ON realtime.messages
          FOR SELECT
          TO authenticated
          USING (
            realtime.topic() = 'owner_activity:' || coalesce(
              auth.jwt() -> 'app_metadata' ->> 'jobbbler_owner_id',
              ''
            )
          )
      $policy$;
    END IF;

    IF to_regprocedure('jobbbler.broadcast_owner_activity_wakeup()') IS NULL THEN
      EXECUTE $function$
        CREATE FUNCTION jobbbler.broadcast_owner_activity_wakeup()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = ''
        AS $body$
        BEGIN
          PERFORM realtime.send('{}'::jsonb, 'changed', 'owner_activity:' || NEW.owner_id, true);
          RETURN NEW;
        END
        $body$
      $function$;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'owner_activity_events_after_insert_wakeup'
        AND tgrelid = 'jobbbler.owner_activity_events'::regclass
    ) THEN
      EXECUTE $trigger$
        CREATE TRIGGER owner_activity_events_after_insert_wakeup
        AFTER INSERT ON jobbbler.owner_activity_events
        FOR EACH ROW
        EXECUTE FUNCTION jobbbler.broadcast_owner_activity_wakeup()
      $trigger$;
    END IF;
  END IF;
END
$jobbbler$;
