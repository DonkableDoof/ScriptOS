-- ScriptOS's server. Run this in the Supabase SQL editor (safe to run again).
--
-- Two separate things live here:
--
-- Sharing. A share is one row in `shares`: the script, its cover and its character icons
-- are all inside that row, and members, comments and suggested edits hang off it, so
-- deleting the row removes every trace of the shared copy.
--
-- Sync. `cloud_items` holds the scripts and scrambles someone chose to upload to their
-- own account, readable by nobody else, and `sync_devices` their devices (one Host, the
-- rest Links). Anything not uploaded never leaves the device.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar text check (avatar is null or (avatar like 'data:image/%' and char_length(avatar) < 200000)),
  updated_at timestamptz not null default now()
);

-- every new account gets a profile, named from what they typed when signing up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(left(trim(new.raw_user_meta_data ->> 'display_name'), 40), ''), 'New Writer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Shares
-- ---------------------------------------------------------------------------

-- Ten characters from an alphabet with no lookalikes (no 0/O, 1/I/L): about 50 bits,
-- far too many to guess. Written XXXXX-XXXXX.
create or replace function public.new_share_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex');
  code text := '';
  -- a uuid's bytes 6 and 8 hold fixed version bits, so those are skipped
  picks constant int[] := array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11];
  i int;
begin
  foreach i in array picks loop
    code := code || substr(alphabet, 1 + get_byte(bytes, i) % length(alphabet), 1);
  end loop;
  return substr(code, 1, 5) || '-' || substr(code, 6, 5);
end;
$$;

create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  code text not null unique default public.new_share_code(),
  access text not null default 'anyone' check (access in ('anyone', 'request')),
  title text not null check (char_length(title) <= 300),
  -- { format, author, logline, draft, show, season, episode, blocks: [...] }
  script jsonb not null check (pg_column_size(script) < 8000000),
  cover text check (cover is null or (cover like 'data:image/%' and char_length(cover) < 3000000)),
  -- { "ROSA": { "color": "#e07aa9", "icon": "data:image/png;base64,..." } }
  characters jsonb not null default '{}' check (pg_column_size(characters) < 4000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shares_owner_idx on public.shares (owner);

create table if not exists public.share_members (
  share_id uuid not null references public.shares (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  primary key (share_id, user_id)
);
create index if not exists share_members_user_idx on public.share_members (user_id);

create table if not exists public.share_comments (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.shares (id) on delete cascade,
  author uuid references auth.users (id) on delete set null default auth.uid(),
  block_id text check (char_length(block_id) <= 64),
  quote text check (char_length(quote) <= 2000),
  kind text not null default 'comment' check (kind in ('comment', 'remove', 'add', 'edit')),
  body text not null check (char_length(body) between 1 and 4000),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists share_comments_share_idx on public.share_comments (share_id, created_at);

-- Edits someone suggests on a shared script. One row per line per person: their latest
-- version of that line (or a new line, or the line's removal). The writer accepts or
-- rejects them; either way the row goes. Sync with the script's own lines by `line`.
create table if not exists public.share_changes (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.shares (id) on delete cascade,
  author uuid not null references auth.users (id) on delete cascade default auth.uid(),
  line text not null check (char_length(line) between 1 and 64),
  op text not null check (op in ('edit', 'insert', 'delete')),
  after_line text not null default '' check (char_length(after_line) <= 64),
  line_type text not null default '' check (char_length(line_type) <= 32),
  html text not null default '' check (char_length(html) <= 40000),
  base_html text not null default '' check (char_length(base_html) <= 40000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (share_id, author, line)
);
create index if not exists share_changes_share_idx on public.share_changes (share_id);

-- A script or scramble uploaded to someone's own account. `rev` goes up with every
-- change, which is how a device knows whether what it edited is still the latest.
-- A deleted item keeps its row without the data, so other devices learn it's gone.
create table if not exists public.cloud_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  kind text not null check (kind in ('script', 'scramble')),
  state text not null default 'live' check (state in ('live', 'deleted', 'local')),
  data jsonb check (data is null or pg_column_size(data) < 12000000),
  rev bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.sync_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  name text not null check (char_length(name) between 1 and 60),
  role text not null check (role in ('host', 'link')),
  removed boolean not null default false,
  activity jsonb not null default '{}' check (pg_column_size(activity) < 500000),
  last_seen timestamptz not null default now(),
  primary key (user_id, id)
);
create unique index if not exists sync_devices_one_host on public.sync_devices (user_id) where role = 'host' and not removed;

-- the time of the last upload, set by the database rather than whoever's clock
create or replace function public.touch_share()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.owner := old.owner;
  return new;
end;
$$;

drop trigger if exists shares_touch on public.shares;
create trigger shares_touch before update on public.shares
  for each row execute function public.touch_share();

-- an account can only have so many scripts up at once, so nobody can fill the database
create or replace function public.limit_shares()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.shares where owner = new.owner) >= 50 then
    raise exception 'You can share up to 50 scripts at a time.';
  end if;
  return new;
end;
$$;

drop trigger if exists shares_limit on public.shares;
create trigger shares_limit before insert on public.shares
  for each row execute function public.limit_shares();

-- and a script can only collect so many comments
create or replace function public.limit_comments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.share_comments where share_id = new.share_id) >= 5000 then
    raise exception 'This script has reached its limit of 5000 comments.';
  end if;
  return new;
end;
$$;

drop trigger if exists comments_limit on public.share_comments;
create trigger comments_limit before insert on public.share_comments
  for each row execute function public.limit_comments();

create or replace function public.touch_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.author := old.author;
  new.share_id := old.share_id;
  return new;
end;
$$;

drop trigger if exists changes_touch on public.share_changes;
create trigger changes_touch before update on public.share_changes
  for each row execute function public.touch_change();

create or replace function public.limit_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.share_changes where share_id = new.share_id) >= 5000 then
    raise exception 'This script has reached its limit of 5000 suggested changes.';
  end if;
  return new;
end;
$$;

drop trigger if exists changes_limit on public.share_changes;
create trigger changes_limit before insert on public.share_changes
  for each row execute function public.limit_changes();

-- ---------------------------------------------------------------------------
-- Who can see what
-- ---------------------------------------------------------------------------
create or replace function public.can_read_share(sid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shares s where s.id = sid and s.owner = auth.uid())
      or exists (select 1 from public.share_members m where m.share_id = sid and m.user_id = auth.uid() and m.status = 'approved');
$$;

create or replace function public.owns_share(sid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shares s where s.id = sid and s.owner = auth.uid());
$$;

alter table public.profiles enable row level security;
alter table public.shares enable row level security;
alter table public.share_members enable row level security;
alter table public.share_comments enable row level security;
alter table public.share_changes enable row level security;
alter table public.cloud_items enable row level security;
alter table public.sync_devices enable row level security;

-- Your own profile only. Other people's names and pictures come through share_people,
-- which shows just the people you share a script with, and never an email.
drop policy if exists "profiles: own" on public.profiles;
create policy "profiles: own" on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "shares: read" on public.shares;
-- owner is checked directly: a row being inserted isn't visible to the function yet
create policy "shares: read" on public.shares for select to authenticated using (owner = auth.uid() or public.can_read_share(id));
drop policy if exists "shares: create" on public.shares;
create policy "shares: create" on public.shares for insert to authenticated with check (owner = auth.uid());
drop policy if exists "shares: change" on public.shares;
create policy "shares: change" on public.shares for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "shares: delete" on public.shares;
create policy "shares: delete" on public.shares for delete to authenticated using (owner = auth.uid());

-- Joining goes through join_share. The owner decides requests; a member can leave.
drop policy if exists "members: read" on public.share_members;
create policy "members: read" on public.share_members for select to authenticated
  using (user_id = auth.uid() or public.owns_share(share_id));
drop policy if exists "members: decide" on public.share_members;
create policy "members: decide" on public.share_members for update to authenticated
  using (public.owns_share(share_id)) with check (public.owns_share(share_id));
drop policy if exists "members: remove" on public.share_members;
create policy "members: remove" on public.share_members for delete to authenticated
  using (public.owns_share(share_id) or (user_id = auth.uid() and status <> 'denied'));

drop policy if exists "comments: read" on public.share_comments;
create policy "comments: read" on public.share_comments for select to authenticated using (public.can_read_share(share_id));
drop policy if exists "comments: write" on public.share_comments;
create policy "comments: write" on public.share_comments for insert to authenticated
  with check (author = auth.uid() and public.can_read_share(share_id));
drop policy if exists "comments: change" on public.share_comments;
create policy "comments: change" on public.share_comments for update to authenticated
  using (author = auth.uid() or public.owns_share(share_id))
  with check ((author = auth.uid() or public.owns_share(share_id)) and public.can_read_share(share_id));
drop policy if exists "comments: delete" on public.share_comments;
create policy "comments: delete" on public.share_comments for delete to authenticated
  using (author = auth.uid() or public.owns_share(share_id));

-- Suggestions: everyone on the script sees them, people change their own, and the writer
-- can clear anyone's by accepting or rejecting it.
drop policy if exists "changes: read" on public.share_changes;
create policy "changes: read" on public.share_changes for select to authenticated using (public.can_read_share(share_id));
drop policy if exists "changes: write" on public.share_changes;
create policy "changes: write" on public.share_changes for insert to authenticated
  with check (author = auth.uid() and public.can_read_share(share_id));
drop policy if exists "changes: change" on public.share_changes;
create policy "changes: change" on public.share_changes for update to authenticated
  using (author = auth.uid() and public.can_read_share(share_id))
  with check (author = auth.uid() and public.can_read_share(share_id));
drop policy if exists "changes: delete" on public.share_changes;
create policy "changes: delete" on public.share_changes for delete to authenticated
  using (author = auth.uid() or public.owns_share(share_id));

-- Your uploaded items and devices are yours alone. They're read directly and changed
-- through the functions below, which keep the revisions and the Host straight.
drop policy if exists "cloud: own" on public.cloud_items;
create policy "cloud: own" on public.cloud_items for select to authenticated using (user_id = auth.uid());
drop policy if exists "devices: own" on public.sync_devices;
create policy "devices: own" on public.sync_devices for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------

-- Using a code. Anyone-with-the-code shares open straight away; the others ask first.
-- A wrong code says nothing about what exists.
create or replace function public.join_share(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  clean text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  target public.shares%rowtype;
  current_status text;
  owner_name text;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if length(clean) <> 10 then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into target from public.shares where code = substr(clean, 1, 5) || '-' || substr(clean, 6, 5);
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select display_name into owner_name from public.profiles where id = target.owner;
  if target.owner = me then
    return jsonb_build_object('status', 'owner', 'share_id', target.id, 'title', target.title, 'owner_name', owner_name);
  end if;

  select status into current_status from public.share_members where share_id = target.id and user_id = me;
  if current_status is null then
    current_status := case when target.access = 'anyone' then 'approved' else 'pending' end;
    insert into public.share_members (share_id, user_id, status) values (target.id, me, current_status);
  elsif current_status = 'pending' and target.access = 'anyone' then
    current_status := 'approved';
    update public.share_members set status = 'approved' where share_id = target.id and user_id = me;
  end if;

  if current_status = 'denied' then
    return jsonb_build_object('status', 'denied');
  end if;
  return jsonb_build_object('status', current_status, 'share_id', target.id, 'title', target.title, 'owner_name', owner_name);
end;
$$;

-- Scripts shared with me, for the home page: titles only, no script text.
create or replace function public.shared_with_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'share_id', s.id, 'status', m.status, 'title', s.title,
    'owner_name', p.display_name, 'updated_at', s.updated_at
  ) order by s.updated_at desc), '[]'::jsonb)
  from public.share_members m
  join public.shares s on s.id = m.share_id
  left join public.profiles p on p.id = s.owner
  where m.user_id = auth.uid() and m.status <> 'denied';
$$;

-- Names and pictures of the people on a share. Only the owner sees who's waiting or
-- was turned down.
create or replace function public.share_people(p_share uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not public.can_read_share(p_share) then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'avatar', p.avatar, 'status', who.status
  )), '[]'::jsonb)
  into result
  from (
    select s.owner as id, 'owner' as status from public.shares s where s.id = p_share
    union
    select m.user_id, m.status from public.share_members m
      where m.share_id = p_share and (m.status = 'approved' or public.owns_share(p_share))
    union
    select c.author, 'commented' from public.share_comments c
      where c.share_id = p_share and c.author is not null
        and not exists (select 1 from public.share_members m where m.share_id = p_share and m.user_id = c.author)
    union
    select g.author, 'commented' from public.share_changes g
      where g.share_id = p_share
        and not exists (select 1 from public.share_members m where m.share_id = p_share and m.user_id = g.author)
  ) who
  join public.profiles p on p.id = who.id;
  return result;
end;
$$;

-- Uploading an item. p_base_rev is the revision this device last saw: if the server has
-- moved on since, nothing is written and the device sorts out the conflict.
create or replace function public.push_cloud_item(p_id text, p_kind text, p_data jsonb, p_base_rev bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  cur public.cloud_items%rowtype;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  select * into cur from public.cloud_items where user_id = me and id = p_id for update;
  if not found then
    if (select count(*) from public.cloud_items where user_id = me) >= 2000 then
      raise exception 'You can upload up to 2000 scripts and scrambles.';
    end if;
    insert into public.cloud_items (user_id, id, kind, data) values (me, p_id, p_kind, p_data);
    return jsonb_build_object('rev', 1);
  end if;
  if cur.state = 'live' and cur.rev <> p_base_rev then
    return jsonb_build_object('conflict', true, 'rev', cur.rev);
  end if;
  update public.cloud_items set data = p_data, kind = p_kind, state = 'live', rev = cur.rev + 1, updated_at = now()
    where user_id = me and id = p_id;
  return jsonb_build_object('rev', cur.rev + 1);
end;
$$;

-- Deleted everywhere, or taken off the account with each device keeping its copy. Either
-- way the data itself is removed from the server.
create or replace function public.set_cloud_state(p_id text, p_state text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('deleted', 'local') then
    raise exception 'Unknown state.';
  end if;
  update public.cloud_items set state = p_state, data = null, rev = rev + 1, updated_at = now()
    where user_id = auth.uid() and id = p_id;
end;
$$;

-- A device reporting in: the first one on an account becomes Host, and the rest Links.
-- A device the Host removed stays out until someone chooses to link it again.
create or replace function public.device_checkin(p_id text, p_name text, p_activity jsonb, p_relink boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  cur public.sync_devices%rowtype;
  new_role text;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  select * into cur from public.sync_devices where user_id = me and id = p_id;
  if found and cur.removed and not p_relink then
    return jsonb_build_object('removed', true, 'role', cur.role);
  end if;
  if not found and (select count(*) from public.sync_devices where user_id = me) >= 25 then
    raise exception 'You can link up to 25 devices.';
  end if;
  new_role := case
    when found and not cur.removed then cur.role
    when exists (select 1 from public.sync_devices where user_id = me and role = 'host' and not removed) then 'link'
    else 'host' end;
  insert into public.sync_devices (user_id, id, name, role, activity)
    values (me, p_id, left(p_name, 60), new_role, coalesce(p_activity, '{}'::jsonb))
    on conflict (user_id, id) do update
      set name = excluded.name, role = excluded.role, activity = excluded.activity, removed = false, last_seen = now();
  return jsonb_build_object('role', new_role);
end;
$$;

create or replace function public.device_take_host(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.sync_devices where user_id = me and id = p_id and not removed) then
    raise exception 'This device is not linked.';
  end if;
  update public.sync_devices set role = 'link' where user_id = me and role = 'host';
  update public.sync_devices set role = 'host' where user_id = me and id = p_id;
end;
$$;

-- Only the Host removes a Link. The removed device keeps what it has and stops syncing.
create or replace function public.device_remove(p_self text, p_target text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.sync_devices where user_id = me and id = p_self and role = 'host' and not removed) then
    raise exception 'Only the Host can remove a device.';
  end if;
  if p_self = p_target then
    raise exception 'Hand over the Host role first.';
  end if;
  update public.sync_devices set removed = true, role = 'link' where user_id = me and id = p_target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: nothing at all without an account
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.shares, public.share_members, public.share_comments,
  public.share_changes, public.cloud_items, public.sync_devices from anon;
revoke all on function public.join_share(text), public.shared_with_me(), public.share_people(uuid),
  public.can_read_share(uuid), public.owns_share(uuid), public.new_share_code(),
  public.handle_new_user(), public.touch_share(), public.limit_shares(), public.limit_comments(),
  public.touch_change(), public.limit_changes(),
  public.push_cloud_item(text, text, jsonb, bigint), public.set_cloud_state(text, text),
  public.device_checkin(text, text, jsonb, boolean), public.device_take_host(text), public.device_remove(text, text)
  from public, anon;
-- Supabase grants new functions to signed-in users by default. These only ever run as
-- triggers, so nobody needs to be able to call them.
revoke all on function public.handle_new_user(), public.touch_share(), public.limit_shares(), public.limit_comments(),
  public.touch_change(), public.limit_changes()
  from authenticated;
-- Supabase also grants new tables to signed-in users by default, including TRUNCATE, which
-- row rules don't apply to. So start from nothing and give back only what's needed.
revoke all on public.profiles, public.shares, public.share_members, public.share_comments,
  public.share_changes, public.cloud_items, public.sync_devices from authenticated;
grant select, insert, update, delete on public.profiles, public.shares, public.share_members, public.share_comments, public.share_changes to authenticated;
-- read directly, written only through the functions above
grant select on public.cloud_items, public.sync_devices to authenticated;
grant execute on function public.join_share(text), public.shared_with_me(), public.share_people(uuid),
  public.can_read_share(uuid), public.owns_share(uuid), public.new_share_code(),
  public.push_cloud_item(text, text, jsonb, bigint), public.set_cloud_state(text, text),
  public.device_checkin(text, text, jsonb, boolean), public.device_take_host(text), public.device_remove(text, text)
  to authenticated;
