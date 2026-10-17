-- Sports Social: leaderboards, read through one function so no client ever
-- downloads the games table. Signed-in players only (guests have no games).
--
--   bowling        best single game                       (higher is better)
--   golf           best full round, strokes vs par         (lower is better; all holes played)
--   pingpong_wins  wins against the CPU                    (higher is better)
--   pingpong_rate  win % over all ping pong games, with at least 5 games in the period
--
-- Periods: 'all' (all time) and 'week' (since Monday 00:00 UTC).
-- Returns the top p_limit rows plus, when signed in, the caller's own row
-- wherever it falls. Callable without signing in (the laptop has no session).

create index if not exists games_by_game_and_player on public.games (game, user_id, played_at);

create function public.leaderboard(p_board text, p_period text default 'all', p_limit int default 10)
returns table (rank bigint, user_id uuid, name text, value numeric, games bigint, is_me boolean)
language sql stable security definer set search_path = public as $$
  with per_player as (
    select
      g.user_id,
      case p_board
        when 'bowling' then max(g.score)::numeric
        when 'golf' then min(g.score)::numeric
        when 'pingpong_wins' then (count(*) filter (where g.won and g.details->>'opponent' = 'cpu'))::numeric
        when 'pingpong_rate' then round(100.0 * count(*) filter (where g.won) / count(*), 1)
      end as value,
      count(*) as games
    from games g
    where g.game = case when p_board like 'pingpong%' then 'pingpong' else p_board end
      and g.played_at >= case when p_period = 'week' then date_trunc('week', now()) else '-infinity'::timestamptz end
      and (p_board <> 'golf' or (g.details->>'complete')::boolean)
    group by g.user_id
  ),
  eligible as (
    select * from per_player
    where value is not null
      and (p_board <> 'pingpong_wins' or value > 0)
      and (p_board <> 'pingpong_rate' or games >= 5)
  ),
  ranked as (
    select
      -- Lower is better in golf only.
      rank() over (order by case when p_board = 'golf' then e.value else -e.value end) as rank,
      e.user_id,
      p.name,
      e.value,
      e.games,
      coalesce(e.user_id = auth.uid(), false) as is_me
    from eligible e
    join profiles p on p.id = e.user_id
  )
  select * from ranked
  where rank <= least(greatest(p_limit, 1), 50) or is_me
  order by rank, games desc, name
$$;
grant execute on function public.leaderboard(text, text, int) to anon, authenticated;
