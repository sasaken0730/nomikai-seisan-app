-- 会ごとの固定額。
-- 遅刻・主役・あまり飲まなかった、など「その会に限った事情」を表すため、
-- 参加者単位ではなく (会 × 参加者) に固定額を持たせる。
-- null は「固定しない」＝通常どおり傾斜配分の対象。
--
-- 適用方法: Supabase ダッシュボード → SQL Editor に貼り付けて実行する。

alter table public.nomikai_seisan_event_attendances
  add column if not exists fixed_amount numeric;

comment on column public.nomikai_seisan_event_attendances.fixed_amount is
  'この会におけるこの参加者の固定負担額。null なら傾斜配分の対象。';
