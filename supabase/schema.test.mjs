// Runs supabase/schema.sql in a real Postgres (PGlite) with Supabase's auth pieces
// stubbed, then acts as different users to prove who can see and do what.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
await db.exec(schema);
await db.exec(schema); // must be safe to run twice
console.log("ok   schema runs, and runs again");

let fails = 0;
const check = (label, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${label}${cond ? "" : "  " + JSON.stringify(extra)}`); if (!cond) fails++; };

const as = async (uid, sql, params = []) => {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role;"); }
};
const fails_as = async (uid, sql, params = []) => { try { const r = await as(uid, sql, params); return { failed: false, rows: r }; } catch (e) { return { failed: true, msg: e.message }; } };

const user = async (name) => (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`${name}@x.test`, JSON.stringify({ display_name: name })])).rows[0].id;
const A = await user("Ana"), B = await user("Ben"), C = await user("Cleo"), D = await user("Dee");

check("signing up makes a profile with the chosen name", (await as(A, `select display_name from profiles`))[0]?.display_name === "Ana");
check("profiles: can't read anyone else's directly", (await as(A, `select * from profiles`)).length === 1);
check("profiles: can set own picture", (await as(A, `update profiles set avatar='data:image/png;base64,AAA' where id=auth.uid() returning id`)).length === 1);
check("profiles: can't change someone else's", (await as(A, `update profiles set display_name='x' where id=$1 returning id`, [B])).length === 0);
check("emails aren't anywhere readable", (await fails_as(A, `select email from auth.users`)).failed);

check("no account: can't read shares", (await fails_as(null, `select * from shares`)).failed);
check("no account: can't use a code", (await fails_as(null, `select join_share('AAAAA-BBBBB')`)).failed);

// Ana shares
const open = (await as(A, `insert into shares (owner, title, script, characters, cover) values (auth.uid(), 'Open Script', '{"blocks":[]}', '{"ROSA":{"color":"#fff"}}', 'data:image/jpeg;base64,AA') returning id, code`))[0];
const closed = (await as(A, `insert into shares (owner, title, access, script) values (auth.uid(), 'Private Script', 'request', '{"blocks":[]}') returning id, code`))[0];
check("codes look like XXXXX-XXXXX", /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(open.code), open.code);
check("can't create a share as someone else", (await fails_as(B, `insert into shares (owner, title, script) values ($1, 'x', '{}')`, [A])).failed);
check("strangers can't list shares", (await as(B, `select * from shares`)).length === 0);
check("strangers can't read comments", (await as(B, `select * from share_comments`)).length === 0);
check("strangers can't add themselves as members", (await fails_as(B, `insert into share_members (share_id,user_id,status) values ($1, auth.uid(), 'approved')`, [closed.id])).failed);
check("strangers can't comment", (await fails_as(B, `insert into share_comments (share_id, body) values ($1, 'hi')`, [open.id])).failed);
check("strangers can't change a share", (await as(B, `update shares set title='x' where id=$1 returning id`, [open.id])).length === 0);
check("strangers can't delete a share", (await as(B, `delete from shares where id=$1 returning id`, [open.id])).length === 0);
check("strangers see no people", (await as(B, `select share_people($1) p`, [open.id]))[0].p.length === 0);

// codes
const join = async (u, code) => (await as(u, `select join_share($1) j`, [code]))[0].j;
check("a wrong code finds nothing", (await join(B, "AAAAA-22222")).status === "not_found");
check("rubbish code finds nothing", (await join(B, "x")).status === "not_found");
let j = await join(B, open.code.toLowerCase().replace("-", " "));
check("anyone-with-code opens straight away (any case, any spacing)", j.status === "approved" && j.title === "Open Script" && j.owner_name === "Ana", j);
check("member can read the script, cover and icons", (await as(B, `select script, cover, characters from shares where id=$1`, [open.id]))[0]?.characters?.ROSA?.color === "#fff");
check("member still can't see the other share", (await as(B, `select id from shares`)).length === 1);
check("member can't change the script", (await as(B, `update shares set script='{}' where id=$1 returning id`, [open.id])).length === 0);
check("member can't approve others / promote", (await as(B, `update share_members set status='approved' where share_id=$1 returning user_id`, [closed.id])).length === 0);

j = await join(C, closed.code);
check("request-access waits", j.status === "pending" && j.title === "Private Script", j);
check("waiting: can't read the script", (await as(C, `select * from shares where id=$1`, [closed.id])).length === 0);
check("waiting: can't comment", (await fails_as(C, `insert into share_comments (share_id, body) values ($1,'hi')`, [closed.id])).failed);
check("waiting: can't approve themselves", (await as(C, `update share_members set status='approved' where share_id=$1 and user_id=auth.uid() returning user_id`, [closed.id])).length === 0);
check("waiting: home page shows title without script", (await as(C, `select shared_with_me() s`))[0].s[0]?.status === "pending");
check("owner sees who's waiting", (await as(A, `select share_people($1) p`, [closed.id]))[0].p.some((p) => p.status === "pending" && p.display_name === "Cleo"));
check("using the code again doesn't duplicate", (await join(C, closed.code)).status === "pending");
check("owner approves", (await as(A, `update share_members set status='approved' where share_id=$1 and user_id=$2 returning user_id`, [closed.id, C])).length === 1);
check("approved: can read", (await as(C, `select id from shares where id=$1`, [closed.id])).length === 1);

j = await join(D, closed.code);
await as(A, `update share_members set status='denied' where share_id=$1 and user_id=$2`, [closed.id, D]);
check("turned down: code says so", (await join(D, closed.code)).status === "denied");
check("turned down: not on their home page", (await as(D, `select shared_with_me() s`))[0].s.length === 0);
check("turned down: can't delete the denial and retry", (await as(D, `delete from share_members where share_id=$1 and user_id=auth.uid() returning user_id`, [closed.id])).length === 0);
check("turned down: other people hidden from a non-owner", !(await as(C, `select share_people($1) p`, [closed.id]))[0].p.some((p) => p.status === "denied"));

check("the owner joining their own code is told so", (await join(A, open.code)).status === "owner");

// comments
const c1 = (await as(B, `insert into share_comments (share_id, block_id, quote, kind, body) values ($1,'b1','the line','remove','Cut this') returning id, author`, [open.id]))[0];
check("member comments, author stamped", c1.author === B);
check("can't comment as someone else", (await fails_as(B, `insert into share_comments (share_id, author, body) values ($1,$2,'fake')`, [open.id, A])).failed);
check("kinds are limited", (await fails_as(B, `insert into share_comments (share_id, kind, body) values ($1,'nonsense','x')`, [open.id])).failed);
check("owner reads it", (await as(A, `select body from share_comments where share_id=$1`, [open.id]))[0]?.body === "Cut this");
check("owner resolves it", (await as(A, `update share_comments set resolved=true where id=$1 returning id`, [c1.id])).length === 1);
check("people includes commenters with names, no email", JSON.stringify((await as(A, `select share_people($1) p`, [open.id]))[0].p).includes("Ben") && !JSON.stringify((await as(A, `select share_people($1) p`, [open.id]))[0].p).includes("@"));
const c2 = (await as(C, `insert into share_comments (share_id, body) values ($1,'mine') returning id`, [closed.id]))[0];
check("another member can't delete my comment", (await as(B, `delete from share_comments where id=$1 returning id`, [c2.id])).length === 0);
check("I can delete my own", (await as(C, `delete from share_comments where id=$1 returning id`, [c2.id])).length === 1);

// owner can't be reassigned, and sizes hold
await as(A, `update shares set owner=$2, title='New' where id=$1`, [open.id, B]);
check("owner can't be changed by update", (await db.query(`select owner from shares where id=$1`, [open.id])).rows[0].owner === A);
check("non-image cover refused", (await fails_as(A, `update shares set cover='<script>' where id=$1`, [open.id])).failed);

// stopping: everything goes, the account stays
check("a member can leave", (await as(C, `delete from share_members where share_id=$1 and user_id=auth.uid() returning user_id`, [closed.id])).length === 1);
await as(A, `delete from shares where id=$1`, [open.id]);
const left = async (t) => (await db.query(`select count(*)::int n from ${t} where share_id=$1`, [open.id])).rows[0].n;
check("stop sharing: script row gone", (await db.query(`select count(*)::int n from shares where id=$1`, [open.id])).rows[0].n === 0);
check("stop sharing: members gone", (await left("share_members")) === 0);
check("stop sharing: comments gone", (await left("share_comments")) === 0);
check("stop sharing: account stays", (await as(A, `select display_name from profiles`))[0]?.display_name === "Ana");
check("the old code no longer works", (await join(B, open.code)).status === "not_found");

// suggestions
const sugg = (await as(A, `insert into shares (owner, title, script) values (auth.uid(), 'Sugg', '{"blocks":[]}') returning id, code`))[0];
const line = (await as(B, `select join_share($1) j`, [sugg.code]))[0].j;
check("reader joins to suggest", line.status === "approved");
const ch = (await as(B, `insert into share_changes (share_id, line, op, html, base_html) values ($1,'b1','edit','new','old') returning id, author`, [sugg.id]))[0];
check("reader suggests a change, stamped as theirs", ch.author === B);
check("one row per line per person", (await fails_as(B, `insert into share_changes (share_id, line, op, html) values ($1,'b1','edit','x')`, [sugg.id])).failed);
check("upsert keeps it to one row", (await as(B, `insert into share_changes (share_id, line, op, html) values ($1,'b1','edit','newer') on conflict (share_id, author, line) do update set html = excluded.html returning html`, [sugg.id]))[0].html === "newer");
check("can't suggest as someone else", (await fails_as(B, `insert into share_changes (share_id, author, line, op) values ($1,$2,'b2','edit')`, [sugg.id, A])).failed);
check("ops are limited", (await fails_as(B, `insert into share_changes (share_id, line, op) values ($1,'b3','nonsense')`, [sugg.id])).failed);
check("strangers can't suggest", (await fails_as(C, `insert into share_changes (share_id, line, op) values ($1,'b4','edit')`, [sugg.id])).failed);
check("strangers can't see suggestions", (await as(C, `select id from share_changes where share_id=$1`, [sugg.id])).length === 0);
check("writer sees it", (await as(A, `select html from share_changes where share_id=$1`, [sugg.id]))[0]?.html === "newer");
check("writer can't rewrite someone's suggestion", (await as(A, `update share_changes set html='forged' where id=$1 returning id`, [ch.id])).length === 0);
check("a change can't be moved to another author by update", (await as(B, `update share_changes set author=$2, html='x' where id=$1 returning author`, [ch.id, A]))[0]?.author === B);
check("people lists whoever suggested", JSON.stringify((await as(A, `select share_people($1) p`, [sugg.id]))[0].p).includes("Ben"));
await as(B, `delete from share_members where share_id=$1 and user_id=auth.uid()`, [sugg.id]);
check("after leaving, their suggestion still shows to the writer", (await as(A, `select id from share_changes where share_id=$1`, [sugg.id])).length === 1);
check("after leaving, they can't change it", (await as(B, `update share_changes set html='y' where id=$1 returning id`, [ch.id])).length === 0);
check("writer clears it by accept/reject", (await as(A, `delete from share_changes where id=$1 returning id`, [ch.id])).length === 1);
await as(B, `select join_share($1)`, [sugg.code]);
await as(B, `insert into share_changes (share_id, line, op) values ($1,'b9','delete')`, [sugg.id]);
await as(A, `delete from shares where id=$1`, [sugg.id]);
check("stop sharing removes suggestions", (await db.query(`select count(*)::int n from share_changes where share_id=$1`, [sugg.id])).rows[0].n === 0);

// sync: items
const push = async (u, id, data, base) => (await as(u, `select push_cloud_item($1,'script',$2,$3) r`, [id, JSON.stringify(data), base]))[0].r;
check("first upload is revision 1", (await push(A, "s1", { title: "One" }, 0)).rev === 1);
check("next upload moves on", (await push(A, "s1", { title: "Two" }, 1)).rev === 2);
const stale = await push(A, "s1", { title: "Old device" }, 1);
check("a device that missed a change is told, not overwritten", stale.conflict === true && stale.rev === 2);
check("the stale write changed nothing", (await as(A, `select data->>'title' t from cloud_items where id='s1'`))[0].t === "Two");
check("nobody else can read my uploads", (await as(B, `select id from cloud_items`)).length === 0);
await push(B, "s1", { title: "Ben's own s1" }, 0);
check("same item id on two accounts stays separate", (await as(A, `select data->>'title' t from cloud_items where id='s1'`))[0].t === "Two" && (await as(B, `select data->>'title' t from cloud_items where id='s1'`))[0].t === "Ben's own s1");
check("no direct writes to uploads", (await fails_as(A, `update cloud_items set rev=99 where id='s1'`)).failed && (await fails_as(A, `insert into cloud_items (user_id,id,kind) values (auth.uid(),'x','script')`)).failed && (await fails_as(A, `delete from cloud_items where id='s1'`)).failed);
check("no account: can't touch uploads", (await fails_as(null, `select * from cloud_items`)).failed && (await fails_as(null, `select push_cloud_item('x','script','{}',0)`)).failed);
await as(A, `select set_cloud_state('s1','deleted')`);
const gone = (await as(A, `select state, data, rev from cloud_items where id='s1'`))[0];
check("deleting clears the data and tells other devices", gone.state === "deleted" && gone.data === null && gone.rev === 3);
check("deleting mine leaves Ben's alone", (await as(B, `select state from cloud_items where id='s1'`))[0].state === "live");
check("uploading again brings it back", (await push(A, "s1", { title: "Back" }, 0)).rev === 4);
await as(A, `select set_cloud_state('s1','local')`);
check("making it local clears the data too", (await as(A, `select state, data from cloud_items where id='s1'`))[0].data === null);

// sync: devices
const checkin = async (u, id, relink = false) => (await as(u, `select device_checkin($1,$2,'{"2026-11-04":{"words":5,"lines":1}}',$3) r`, [id, id + " name", relink]))[0].r;
check("first device is Host", (await checkin(A, "d1")).role === "host");
check("second device is a Link", (await checkin(A, "d2")).role === "link");
check("checking in again keeps the role", (await checkin(A, "d1")).role === "host");
check("another account gets its own Host", (await checkin(B, "d1")).role === "host");
check("I can't see other accounts' devices", (await as(A, `select id from sync_devices`)).length === 2);
check("a Link can't remove anything", (await fails_as(A, `select device_remove('d2','d1')`)).failed);
check("Host can't remove itself", (await fails_as(A, `select device_remove('d1','d1')`)).failed);
await as(A, `select device_remove('d1','d2')`);
check("a removed device is told and stays out", (await checkin(A, "d2")).removed === true);
check("it can choose to link again, as a Link", (await checkin(A, "d2", true)).role === "link");
await as(A, `select device_take_host('d2')`);
const roles = Object.fromEntries((await as(A, `select id, role from sync_devices`)).map((d) => [d.id, d.role]));
check("handing over: exactly one Host", roles.d2 === "host" && roles.d1 === "link");
check("no direct writes to devices", (await fails_as(A, `update sync_devices set role='host'`)).failed);
check("can't take Host for a device that isn't linked", (await fails_as(A, `select device_take_host('nope')`)).failed);
check("activity travels for the stats", (await as(A, `select activity from sync_devices where id='d1'`))[0].activity["2026-11-04"].words === 5);

// deleting an account takes everything of theirs
const E = await user("Evie");
await as(E, `select push_cloud_item('e1','script','{}',0)`); await as(E, `select device_checkin('ed','Evie laptop','{}')`);
const es = (await as(E, `insert into shares (owner, title, script) values (auth.uid(),'E','{}') returning id, code`))[0];
await as(B, `select join_share($1)`, [es.code]);
await as(B, `insert into share_changes (share_id, line, op) values ($1,'x','delete')`, [es.id]);
await db.query(`delete from auth.users where id=$1`, [B]);
check("deleted account: their suggestions go", (await db.query(`select count(*)::int n from share_changes where share_id=$1`, [es.id])).rows[0].n === 0);
check("deleted account: their profile and picture go", (await db.query(`select count(*)::int n from profiles where id=$1`, [B])).rows[0].n === 0);
check("deleted account: their uploads and devices go", (await db.query(`select (select count(*) from cloud_items where user_id=$1)::int + (select count(*) from sync_devices where user_id=$1)::int n`, [B])).rows[0].n === 0);
check("other people's data is untouched", (await db.query(`select count(*)::int n from cloud_items where user_id=$1`, [E])).rows[0].n === 1);

// limit
await db.query(`insert into shares (owner, title, script) select $1, 't', '{}' from generate_series(1, 49)`, [D]);
await db.query(`insert into shares (owner, title, script) values ($1,'t','{}')`, [D]);
check("limit of 50 shares per account", (await fails_as(D, `insert into shares (owner, title, script) values (auth.uid(),'t','{}')`)).failed);

// row rules don't apply to these, so nobody but the database itself may have them
const TABLES = ["profiles", "shares", "share_members", "share_comments", "share_changes", "cloud_items", "sync_devices"];
for (const t of TABLES) {
  const { rows } = await db.query(
    `select has_table_privilege('authenticated', 'public.${t}', 'TRUNCATE') or has_table_privilege('authenticated', 'public.${t}', 'TRIGGER') or has_table_privilege('authenticated', 'public.${t}', 'REFERENCES') as has`
  );
  check(`${t}: signed-in users can't empty it or attach to it`, rows[0].has === false);
}
check("emptying a table as a signed-in user is refused", (await fails_as(A, `truncate public.share_comments cascade`)).failed);

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
