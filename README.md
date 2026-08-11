# ⚖️ 傾斜精算くん

役職・年次に応じて飲み会の支払いを傾斜配分する、iOS向け精算アプリ。
幹事の「誰がいくら払うか」の計算をゼロにすることを目指しています。

## 主な機能

- 役職・年次に応じた傾斜配分（倍率は1.0〜5.0倍から選択可能）
- 傾斜配分 / 均等割りをイベント（1次会・2次会…）ごとに切り替え可能
- 複数イベント対応、出席管理（イベントごとの参加者チェック）
- 立替者の設定と自動精算（誰が誰にいくら払うか）
- 傾斜倍率パターンの比較表示
- 丸め単位（500円／1000円）の選択
- 履歴・テンプレートからのコピー作成
- 精算結果の内訳・サマリーをコピーしてLINE等で共有
- 入力内容のオートセーブ（下書き）とホーム画面での再開導線
- URLでの精算結果共有

## 技術スタック

| 種別 | 技術 |
|------|------|
| フロントエンド | React Native + Expo (SDK 56) |
| 言語 | TypeScript |
| バックエンド | Supabase（PostgreSQL） |
| ストレージ | @react-native-async-storage/async-storage |
| ナビゲーション | React Navigation |
| ビルド | EAS Build |

## セットアップ

```bash
git clone https://github.com/sasaken0730/nomikai-seisan-app.git
cd nomikai-seisan-app
npm install
```

`.env` ファイルをプロジェクトルートに作成し、Supabaseの接続情報を設定してください。

```env
EXPO_PUBLIC_SUPABASE_URL=【Supabase プロジェクトURL】
EXPO_PUBLIC_SUPABASE_ANON_KEY=【Supabase Anon Key】
```

## ローカル開発

ネイティブモジュール（expo-haptics, expo-clipboard, @react-native-community/datetimepicker等）を含むため、Expo Goではなくカスタム開発クライアントを使用します。

```bash
# 初回・ネイティブ依存を追加した後
npx expo run:ios

# 2回目以降（JSのみの変更）
npx expo start
```

詳細な開発・申請フローは [HANDOFF.md](./HANDOFF.md) を参照してください。

## 変更履歴

[CHANGELOG.md](./CHANGELOG.md) を参照してください。
