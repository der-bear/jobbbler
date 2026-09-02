-- Supabase-hosted scheduler for the bounded Jobbbler alert cycle.
-- Required Vault secrets:
--   jobbbler_public_base_url   clean HTTPS origin, without a trailing slash
--   jobbbler_alert_cycle_secret  same CRON_SECRET configured in Vercel

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $jobbbler$
begin
  if not exists (
    select 1 from vault.secrets where name = 'jobbbler_public_base_url'
  ) or not exists (
    select 1 from vault.secrets where name = 'jobbbler_alert_cycle_secret'
  ) then
    raise exception 'Jobbbler scheduler Vault secrets must be configured first';
  end if;
end
$jobbbler$;

do $jobbbler$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'jobbbler-alert-cycle'
   limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$jobbbler$;

select cron.schedule(
  'jobbbler-alert-cycle',
  '3,13,23,33,43,53 * * * *',
  $cron$
    select net.http_post(
      url := (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'jobbbler_public_base_url'
      ) || '/api/internal/alert-cycle',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'jobbbler_alert_cycle_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $cron$
);
