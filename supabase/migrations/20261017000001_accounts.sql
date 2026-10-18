-- Sports Social: player accounts and career history.
--
-- Players sign in on their phone (Supabase Auth). After a finished game the
-- laptop sends each phone its result over WebRTC, and the phone saves it with
-- its own session through record_game(), the only way to write a game: it
-- recomputes and checks the score, rate-limits, and writes only for the
-- signed-in player. (A player could still invent their own results; only a
-- server running the game could prevent that.)
--
-- Run in the Supabase SQL editor, or `supabase db push`.

-- Display names. Readable by everyone (the other player sees them); each
-- player may change only their own.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "names are public" on public.profiles for select using (true);
create policy "edit your own name" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- A profile for every new account, named from Google or the email address.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''), nullif(split_part(new.email, '@', 1), ''), 'Player'), 24)
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- One row per finished game per signed-in player.
--   bowling:  score = total pins (0-300); details { rolls[], won? }
--   golf:     score = strokes minus par over the holes played; details { strokes[], par[], holes, complete, won? }
--   pingpong: score = own points; details { score: [own, opponent], opponent: 'cpu' | 'human', opponentName }
-- `won` is null for a game played alone.
create table public.games (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  game text not null check (game in ('bowling', 'golf', 'pingpong')),
  played_at timestamptz not null default now(),
  score int not null,
  won boolean,
  details jsonb not null
);
create index games_by_player on public.games (user_id, played_at desc);
create index games_by_game on public.games (game, played_at desc);
alter table public.games enable row level security;
-- Players read their own games. There is no insert, update or delete policy:
-- games are written only by record_game() below.
create policy "read your own games" on public.games for select using (auth.uid() = user_id);

-- Ten-pin total from the rolls, rejecting anything that is not a legal, finished game.
create function public.bowling_total(rolls int[]) returns int
language plpgsql immutable as $$
declare
  n int := coalesce(array_length(rolls, 1), 0);
  i int := 1;
  total int := 0;
begin
  for k in 1..n loop
    if rolls[k] is null or rolls[k] < 0 or rolls[k] > 10 then
      raise exception 'roll % is out of range', k;
    end if;
  end loop;
  for f in 1..10 loop
    if i > n then raise exception 'the game is not finished'; end if;
    if rolls[i] = 10 then
      -- Strike: ten plus the next two balls.
      if i + 2 > n then raise exception 'the game is not finished'; end if;
      total := total + 10 + rolls[i + 1] + rolls[i + 2];
      if f < 10 then
        i := i + 1;
      else
        if rolls[i + 1] < 10 and rolls[i + 1] + rolls[i + 2] > 10 then raise exception 'the tenth frame has too many pins'; end if;
        i := i + 3;
      end if;
    else
      if i + 1 > n then raise exception 'the game is not finished'; end if;
      if rolls[i] + rolls[i + 1] > 10 then raise exception 'frame % has more than ten pins', f; end if;
      if rolls[i] + rolls[i + 1] = 10 then
        -- Spare: ten plus the next ball.
        if i + 2 > n then raise exception 'the game is not finished'; end if;
        total := total + 10 + rolls[i + 2];
        i := i + case when f < 10 then 2 else 3 end;
      else
        total := total + rolls[i] + rolls[i + 1];
        i := i + 2;
      end if;
    end if;
  end loop;
  if i <= n then raise exception 'there are rolls after the game ended'; end if;
  return total;
end $$;

-- Save a finished game for the signed-in player. Returns the new row's id.
create function public.record_game(p_game text, p_details jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_score int;
  v_won boolean := (p_details->>'won')::boolean;
  v_details jsonb := p_details;
  strokes int[];
  pars int[];
  own int;
  opp int;
  v_id bigint;
begin
  if uid is null then raise exception 'sign in to save games'; end if;
  if (select count(*) from games where user_id = uid and played_at > now() - interval '1 hour') >= 60 then
    raise exception 'too many games saved in the last hour';
  end if;

  if p_game = 'bowling' then
    v_score := bowling_total(array(select jsonb_array_elements_text(p_details->'rolls')::int));
  elsif p_game = 'golf' then
    strokes := array(select jsonb_array_elements_text(p_details->'strokes')::int);
    pars := array(select jsonb_array_elements_text(p_details->'par')::int);
    if coalesce(array_length(strokes, 1), 0) = 0 or array_length(strokes, 1) <> coalesce(array_length(pars, 1), 0)
       or array_length(strokes, 1) > 18 or coalesce((p_details->>'holes')::int, 0) < array_length(strokes, 1) then
      raise exception 'not a golf card';
    end if;
    if exists (select 1 from unnest(strokes) s where s < 1 or s > 20) or exists (select 1 from unnest(pars) p where p < 2 or p > 6) then
      raise exception 'not a golf card';
    end if;
    v_score := (select sum(s) from unnest(strokes) s) - (select sum(p) from unnest(pars) p);
    -- Only a full round counts as a best round.
    v_details := v_details || jsonb_build_object('complete', array_length(strokes, 1) = (p_details->>'holes')::int);
  elsif p_game = 'pingpong' then
    own := (p_details->'score'->>0)::int;
    opp := (p_details->'score'->>1)::int;
    -- First to 11, win by two (past 10-10, exactly two).
    if own is null or opp is null or own < 0 or opp < 0 or greatest(own, opp) < 11 or abs(own - opp) < 2
       or (greatest(own, opp) > 11 and abs(own - opp) <> 2) then
      raise exception 'not a finished ping pong game';
    end if;
    if coalesce(p_details->>'opponent', '') not in ('cpu', 'human') then raise exception 'unknown opponent'; end if;
    v_score := own;
    v_won := own > opp;
  else
    raise exception 'unknown game %', p_game;
  end if;

  insert into games (user_id, game, score, won, details)
  values (uid, p_game, v_score, v_won, v_details)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_game(text, jsonb) from public, anon;
grant execute on function public.record_game(text, jsonb) to authenticated;

-- Career totals per game for the player asking (row level security on games
-- applies through security_invoker, so each player sees only their own).
--   best:    bowling highest total, golf lowest full round vs par, ping pong most points
--   average: the same measure, averaged
create view public.career_stats with (security_invoker = true) as
select
  user_id,
  game,
  count(*) as played,
  count(*) filter (where won) as wins,
  case when game = 'golf' then min(score) filter (where (details->>'complete')::boolean) else max(score) end as best,
  round(avg(score) filter (where game <> 'golf' or (details->>'complete')::boolean), 1) as average
from public.games
group by user_id, game;
