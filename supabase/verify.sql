-- Checks the access rules on the real Supabase server, as real roles. Safe to run on
-- a live project: everything happens in one block that always ends by raising an
-- error, which undoes all of it, test users included. The "error" text is the report.
do $verify$
declare
  ana uuid := gen_random_uuid();
  ben uuid := gen_random_uuid();
  open_id uuid;
  open_code text;
  closed_id uuid;
  closed_code text;
  result text := '';
  fails int := 0;
  n int;
  j jsonb;

  -- a nested helper isn't possible in a DO block, so results are added inline below
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (ana, 'verify-ana@example.invalid', '{"display_name":"Ana"}'),
    (ben, 'verify-ben@example.invalid', '{"display_name":"Ben"}');

  select count(*) into n from public.profiles where id in (ana, ben);
  if n <> 2 then fails := fails + 1; result := result || E'FAIL signup makes profiles\n'; end if;

  -- no account at all
  perform set_config('role', 'anon', true);
  begin
    perform 1 from public.shares limit 1;
    fails := fails + 1; result := result || E'FAIL anon can read shares\n';
  exception when insufficient_privilege then null; end;
  begin
    perform public.join_share('AAAAA-22222');
    fails := fails + 1; result := result || E'FAIL anon can use a code\n';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.profiles limit 1;
    fails := fails + 1; result := result || E'FAIL anon can read profiles\n';
  exception when insufficient_privilege then null; end;

  -- Ana shares two scripts
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  if auth.uid() is distinct from ana then fails := fails + 1; result := result || E'FAIL auth.uid is not the test user\n'; end if;
  insert into public.shares (owner, title, script, characters, cover)
    values (ana, 'Open', '{"blocks":[]}', '{"ROSA":{"color":"#fff"}}', 'data:image/jpeg;base64,AA') returning id, code into open_id, open_code;
  insert into public.shares (owner, title, access, script) values (ana, 'Closed', 'request', '{"blocks":[]}') returning id, code into closed_id, closed_code;
  if open_code !~ '^[A-Z2-9]{5}-[A-Z2-9]{5}$' then fails := fails + 1; result := result || E'FAIL code format\n'; end if;
  select count(*) into n from public.profiles;
  if n <> 1 then fails := fails + 1; result := result || E'FAIL can read other profiles\n'; end if;

  -- Ben, a stranger
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  select count(*) into n from public.shares;
  if n <> 0 then fails := fails + 1; result := result || E'FAIL stranger lists shares\n'; end if;
  begin
    insert into public.share_members (share_id, user_id, status) values (closed_id, ben, 'approved');
    fails := fails + 1; result := result || E'FAIL stranger joins directly\n';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.share_comments (share_id, author, body) values (open_id, ben, 'hi');
    fails := fails + 1; result := result || E'FAIL stranger comments\n';
  exception when insufficient_privilege then null; end;
  update public.shares set title = 'x' where id = open_id;
  delete from public.shares where id = open_id;
  select count(*) into n from public.share_people(open_id) p, jsonb_array_elements(p) e;
  if n <> 0 then fails := fails + 1; result := result || E'FAIL stranger sees people\n'; end if;

  -- codes
  j := public.join_share('AAAAA-22222');
  if j ->> 'status' <> 'not_found' then fails := fails + 1; result := result || E'FAIL wrong code\n'; end if;
  j := public.join_share(lower(open_code));
  if j ->> 'status' <> 'approved' then fails := fails + 1; result := result || E'FAIL anyone-with-code\n'; end if;
  select count(*) into n from public.shares where characters -> 'ROSA' ->> 'color' = '#fff';
  if n <> 1 then fails := fails + 1; result := result || E'FAIL member can read script\n'; end if;
  update public.shares set script = '{}' where id = open_id;
  j := public.join_share(closed_code);
  if j ->> 'status' <> 'pending' then fails := fails + 1; result := result || E'FAIL request access\n'; end if;
  select count(*) into n from public.shares where id = closed_id;
  if n <> 0 then fails := fails + 1; result := result || E'FAIL waiting can read script\n'; end if;
  update public.share_members set status = 'approved' where share_id = closed_id and user_id = ben;
  insert into public.share_comments (share_id, author, block_id, quote, kind, body) values (open_id, ben, 'b1', 'line', 'remove', 'Cut this');
  begin
    insert into public.share_comments (share_id, author, body) values (open_id, ana, 'forged');
    fails := fails + 1; result := result || E'FAIL comment as someone else\n';
  exception when insufficient_privilege then null; end;

  -- Ana again
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  select count(*) into n from public.shares where id = open_id and title = 'Open' and script ? 'blocks';
  if n <> 1 then fails := fails + 1; result := result || E'FAIL a stranger or member changed a share\n'; end if;
  select count(*) into n from public.share_members where share_id = closed_id and status = 'pending';
  if n <> 1 then fails := fails + 1; result := result || E'FAIL someone approved themselves\n'; end if;
  select count(*) into n from jsonb_array_elements(public.share_people(closed_id)) e where e ->> 'status' = 'pending' and e ->> 'display_name' = 'Ben';
  if n <> 1 then fails := fails + 1; result := result || E'FAIL owner sees requests\n'; end if;
  update public.share_members set status = 'approved' where share_id = closed_id and user_id = ben;
  select count(*) into n from public.share_comments where share_id = open_id and body = 'Cut this';
  if n <> 1 then fails := fails + 1; result := result || E'FAIL owner reads comments\n'; end if;
  if public.share_people(open_id)::text like '%@%' then fails := fails + 1; result := result || E'FAIL email exposed\n'; end if;

  -- suggestions
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  insert into public.share_changes (share_id, author, line, op, html, base_html) values (open_id, ben, 'b1', 'edit', 'new', 'old');
  begin
    insert into public.share_changes (share_id, author, line, op) values (open_id, ana, 'b2', 'edit');
    fails := fails + 1; result := result || E'FAIL suggest as someone else\n';
  exception when insufficient_privilege then null; end;

  -- sync: my uploads are mine
  j := public.push_cloud_item('verify-item', 'script', '{"title":"Ben"}', 0);
  if (j ->> 'rev')::int <> 1 then fails := fails + 1; result := result || E'FAIL first upload\n'; end if;
  j := public.push_cloud_item('verify-item', 'script', '{"title":"Ben 2"}', 0);
  if j ->> 'conflict' is null then fails := fails + 1; result := result || E'FAIL stale upload not refused\n'; end if;
  j := public.device_checkin('verify-d1', 'One', '{}');
  if j ->> 'role' <> 'host' then fails := fails + 1; result := result || E'FAIL first device is Host\n'; end if;
  j := public.device_checkin('verify-d2', 'Two', '{}');
  if j ->> 'role' <> 'link' then fails := fails + 1; result := result || E'FAIL second device is Link\n'; end if;
  begin
    update public.cloud_items set rev = 99;
    fails := fails + 1; result := result || E'FAIL direct write to uploads\n';
  exception when insufficient_privilege then null; end;
  begin
    perform public.device_remove('verify-d2', 'verify-d1');
    fails := fails + 1; result := result || E'FAIL a Link removed a device\n';
  exception when raise_exception then null; end;

  -- Ana's view of Ben's data
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  select count(*) into n from public.cloud_items;
  if n <> 0 then fails := fails + 1; result := result || E'FAIL read another account''s uploads\n'; end if;
  select count(*) into n from public.sync_devices;
  if n <> 0 then fails := fails + 1; result := result || E'FAIL read another account''s devices\n'; end if;
  select count(*) into n from public.share_changes where share_id = open_id;
  if n <> 1 then fails := fails + 1; result := result || E'FAIL writer sees suggestions\n'; end if;

  -- stopping removes everything but the account
  delete from public.shares where id = open_id;
  select count(*) into n from public.shares where id = open_id;
  if n <> 0 then fails := fails + 1; result := result || E'FAIL share not deleted\n'; end if;
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.share_comments where share_id = open_id;
  if n <> 0 then fails := fails + 1; result := result || E'FAIL comments left behind\n'; end if;
  select count(*) into n from public.share_members where share_id = open_id;
  if n <> 0 then fails := fails + 1; result := result || E'FAIL members left behind\n'; end if;
  select count(*) into n from public.share_changes where share_id = open_id;
  if n <> 0 then fails := fails + 1; result := result || E'FAIL suggestions left behind\n'; end if;
  select count(*) into n from public.profiles where id = ana;
  if n <> 1 then fails := fails + 1; result := result || E'FAIL account removed\n'; end if;

  -- row rules don't apply to these, so signed-in users must not hold them
  select count(*) into n from unnest(array['profiles', 'shares', 'share_members', 'share_comments', 'share_changes', 'cloud_items', 'sync_devices']) t
    where has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE')
       or has_table_privilege('authenticated', 'public.' || t, 'TRIGGER')
       or has_table_privilege('authenticated', 'public.' || t, 'REFERENCES');
  if n <> 0 then fails := fails + 1; result := result || E'FAIL signed-in users can empty tables\n'; end if;

  raise exception 'VERIFY DONE: % failures. % (rolled back, nothing kept)', fails, result;
end;
$verify$;
