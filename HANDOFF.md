# 傾斜精算くん HANDOFF ドキュメント

ケイトさんへの引き継ぎ用ドキュメントです。
このアプリの開発状況、セットアップ手順、App Store 申請までの流れをまとめています。

---

## 1. アプリ概要

**アプリ名**：傾斜精算くん（けいしゃせいさんくん）

**目的**：
役職・年次に応じて飲み会の支払いを傾斜配分するアプリ。
幹事の負担計算をゼロにすることを目指す。

**主な機能**：
- メンバーの役職／換算年次に応じた傾斜配分
- 複数イベント（1次会／2次会等）対応
- 立替者の自動精算
- 履歴・テンプレートからのコピー作成
- 傾斜倍率パターンの比較表示
- 丸め単位（500円／1000円）の選択

**Web版（参考）**：
- リポジトリ：`sasaken0730/nomikai-seisan`（ローカルでは `~/projects/nomikai-seisan-web-ref` または `~/projects/warikan`）
- 計算ロジック・UIデザインの参考元

---

## 2. 技術スタック

| 種別 | 技術 |
|------|------|
| フロントエンド | React Native + Expo (SDK 56) |
| 言語 | TypeScript |
| バックエンド | Supabase（PostgreSQL + RLS） |
| ストレージ | @react-native-async-storage/async-storage 2.2.0 |
| ナビゲーション | React Navigation |
| ビルド | EAS Build |
| 配布 | TestFlight → App Store |

---

## 3. リポジトリ情報

**GitHub**：https://github.com/sasaken0730/nomikai-seisan-app

**ブランチ運用**：
- `main`：常に動作する状態を維持
- 開発時は直接 main に commit & push（個人開発のため）

**ローカルセットアップ**：
```bash
git clone https://github.com/sasaken0730/nomikai-seisan-app.git
cd nomikai-seisan-app
npm install
```

---

## 4. 環境変数（.env）

リポジトリには `.env` を含めていません。以下の内容で `.env` ファイルを
プロジェクトルートに作成してください。

```env
EXPO_PUBLIC_SUPABASE_URL=【Supabase プロジェクトURL】
EXPO_PUBLIC_SUPABASE_ANON_KEY=【Supabase Anon Key】
```

**取得方法**：
1. ささけん から Supabase プロジェクトの招待メールを受け取る
2. Supabase ダッシュボード → 該当プロジェクト → Settings → API
3. `Project URL` と `anon public` キーをコピー

---

## 5. ローカル開発の起動

```bash
cd ~/projects/nomikai-seisan-app
npx expo start --host localhost --port 8085
```

起動後、ターミナルで `i` キー → iOS Simulator が起動してアプリ読込。

**注意**：
- `--host localhost` を付けないと、シミュレーターが開発サーバーに繋がらないことがある
- ポート 8085 を使うのは、他アプリと衝突を避けるため
- **Expo Go（App Store版）は最新SDKのみ対応**（現在 SDK 58）。本プロジェクトは SDK 56 のため、
  実機のExpo Goでは開けない。**Xcode iOS Simulator** か、EAS の development build を使うこと

---

## 6. Supabase 構成

**テーブル**：
- `nomikai_seisan_rooms`：精算ルーム
- `nomikai_seisan_participants`：参加者
- `nomikai_seisan_events`：イベント（1次会／2次会等）
- `nomikai_seisan_event_attendances`：出席（会 × 参加者）。`fixed_amount` で会ごとの固定額を保持
- `nomikai_seisan_templates`：テンプレート（保存・再利用用）
- `nomikai_seisan_feedback`：アプリへの評価・改善要望（INSERTのみ許可）

**マイグレーション**：
`supabase/migrations/` に SQL を置いている。**本番には適用済み**（2026-11-14）。
新しい環境を作る場合は Supabase ダッシュボードの SQL Editor で順に実行すること。

**重要カラム**：
- `nomikai_seisan_events.payer_participant_id`：立替者ID（UUID、NULL可）
  → メンバー削除時は ON DELETE SET NULL

**RLS（Row Level Security）**：
- ⚠️ **未整備**。`rooms` / `participants` / `events` / `templates` は anon キーで
  SELECT・UPDATE・DELETE がすべて可能な状態（2026-11-14 に検証済み）。
  anon キーはアプリに同梱される公開値のため、第三者が全データを閲覧・改変できる
- `nomikai_seisan_feedback` のみ INSERT 専用ポリシーで保護済み
- **対応方針**：Supabase の匿名サインインを有効化 → `rooms.owner_id` を追加 →
  UPDATE/DELETE は `owner_id = auth.uid()`、SELECT は share_id ベース、という順で整備する。
  申請とは独立した課題だが、優先度は高い

---

## 7. App Store 申請までの流れ

### ステップ1：ケイトさんの環境セットアップ

1. Node.js（18以上）と npm のインストール
2. Xcode のインストール（App Store から無料）
3. Expo CLI と EAS CLI のインストール：
   ```bash
   npm install -g expo-cli eas-cli
   ```
4. Expo アカウントでログイン：
   ```bash
   eas login
   ```
5. Apple Developer アカウントの確認（ケイト名義で登録済み）

### ステップ2：プロジェクトの取り込み

```bash
git clone https://github.com/sasaken0730/nomikai-seisan-app.git
cd nomikai-seisan-app
npm install
# .env ファイルを作成（前述）
```

### ステップ3：シミュレーターで動作確認

```bash
npx expo start --host localhost --port 8085
# 別ターミナルで Simulator 起動 → i キーでアプリ読込
```

### ステップ4：EAS Build（TestFlight 用）

```bash
eas build --profile preview --platform ios
```

ビルド完了まで 10〜30分。完了後、QRコード or リンクでインストール可能。

### ステップ5：実機テスト

ケイトさん・ささけん の iPhone にインストールして動作確認。
バグや改善点があれば Issue として記録。

### ステップ6：本番ビルド

```bash
eas build --profile production --platform ios
```

### ステップ7：TestFlight にアップロード

```bash
eas submit --platform ios
```

App Store Connect で TestFlight 配信設定 → 内部テスター招待。

### ステップ8：App Store メタデータ入力

App Store Connect にアクセスして以下を入力：
- アプリ名：傾斜精算くん
- サブタイトル：飲み会の精算を一瞬で
- カテゴリ：ユーティリティ or ファイナンス
- 説明文：（要作成）
- キーワード：飲み会, 精算, 割り勘, 幹事, etc
- スクリーンショット：iPhone 6.7インチ / 6.5インチ / 5.5インチ
- プライバシーポリシー URL：（要作成）
- サポート URL：（要作成）

### ステップ9：審査申請

「Submit for Review」ボタン → Apple の審査（通常1〜3日）。
承認後、リリース日を指定 or 即時公開。

---

## 8. アプリ公開前に必要な素材

| 素材 | 仕様 | 状態 |
|------|------|------|
| アプリアイコン | 1024×1024px PNG（角丸なし） | 未作成 |
| スクリーンショット | 6.7" / 6.5" / 5.5" 各3〜10枚 | 未作成 |
| アプリ説明文 | 日本語 最大4000文字 | 未作成 |
| キーワード | カンマ区切り 最大100文字 | 未作成 |
| プロモテキスト | 最大170文字 | 未作成 |
| プライバシーポリシー | Web 公開必須 | 未作成 |
| サポート URL | お問い合わせ先 | 未作成 |
| App プレビュー動画 | 任意 | 未作成 |

---

## 9. 既知の課題・今後の改善候補

### 動作確認待ち
- テンプレート使用時の2モード選択（編集／使用）
- 精算結果画面の編集戻り時の state 保持
- 傾斜倍率切替時の支払い情報即時更新
- 同年次同額バグ修正
- 役職クラス・年次表示
- テンプレート立替者保存（旧テンプレは幹事フォールバック）

### 未実装・要検討
- ユーザー認証（Apple/Google ログイン）
- データのエクスポート機能（CSV/PDF）
- ダークモード対応
- iPad 対応
- Android 版

---

## 10. 連絡・引き継ぎ事項

**作業中に困ったら**：
- ささけん（GitHub: @sasaken0730 / メール: knss0730@gmail.com）に Slack/DM で相談
- Claude Code（プロジェクト内 `CLAUDE.md` 参照）に直接コードを書かせる手段あり

**変更時の注意**：
- main ブランチに直接 push する運用なので、push 前に動作確認推奨
- Supabase のスキーマ変更時は両者で共有

**App Store Connect 操作時**：
- ケイト名義の Apple Developer Program でログイン
- ささけん は Admin/Developer ロールで招待されている（or 招待予定）

---

## 11. 参考リンク

- Expo Docs: https://docs.expo.dev/
- EAS Build: https://docs.expo.dev/build/introduction/
- App Store Connect: https://appstoreconnect.apple.com/
- Apple Developer Program: https://developer.apple.com/programs/
- Supabase Docs: https://supabase.com/docs

---

最終更新：2026-11-14
作成：ささけん（Claude 経由）
