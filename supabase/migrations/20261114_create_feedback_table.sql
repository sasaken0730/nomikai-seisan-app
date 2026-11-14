-- アプリへの評価・改善要望の保存先。
-- 精算結果画面（RoomScreen）から任意で送信される。氏名・メールなどは一切受け取らない。
--
-- 適用方法: Supabase ダッシュボード → SQL Editor にそのまま貼り付けて実行する。

create table if not exists public.nomikai_seisan_feedback (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  -- 端末ごとのランダムID。利用状況（ルーム作成数など）と突き合わせるために持つ。
  device_id   text,
  -- どの精算のあとに送られたか。ルームが消えても意見は残すので on delete set null。
  room_id     uuid references public.nomikai_seisan_rooms(id) on delete set null,
  rating      smallint check (rating is null or rating between 1 and 5),
  comment     text     check (comment is null or char_length(comment) <= 1000),
  app_version text,
  platform    text
);

create index if not exists nomikai_seisan_feedback_created_at_idx
  on public.nomikai_seisan_feedback (created_at desc);

alter table public.nomikai_seisan_feedback enable row level security;

-- アプリ（anon）からは「書き込みのみ」。
-- SELECT ポリシーをあえて作らないことで、他人の意見がアプリから読めないようにする。
-- 集計する側は service_role か SQL Editor から読む。
drop policy if exists "feedback_insert_anon" on public.nomikai_seisan_feedback;
create policy "feedback_insert_anon"
  on public.nomikai_seisan_feedback
  for insert to anon
  with check (
    rating is not null
    or (comment is not null and char_length(btrim(comment)) > 0)
  );
