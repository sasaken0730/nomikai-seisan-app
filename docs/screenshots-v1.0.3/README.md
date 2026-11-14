# v1.0.3 申請用スクリーンショット

## 仕様

- **1320 × 2868**（iPhone 16 Pro Max / 6.9インチ枠）。App Store Connect にそのまま投稿でき、リサイズ不要
- 撮影: iOS Simulator「iPhone 16 Pro Max」、`xcrun simctl io <udid> screenshot`
- **掲載データはすべてデモ用の架空の名前**（田中・鈴木・高橋・山田・佐々木）。実ユーザーの氏名は含まない

## 収録内容

| ファイル | 画面 | 訴求点 |
|---|---|---|
| `01-home.png` | ホーム | アプリの顔。新規精算／履歴／テンプレートの導線と「最近のルーム」 |
| `02-participants-and-fixed-amount.png` | 精算を編集 | 参加者が1人1行・幹事（端数集約）・**山田さんの1次会に3,000円の固定額チップ**・「長押しでその会だけ金額を固定」のヒント |
| `03-result-amounts.png` | 精算結果 | 傾斜2.0倍で5名ぶんの金額・役職/年次バッジ・丸め単位の切替・履歴に自動保存済み |
| `04-settlement-and-copy.png` | 精算結果（下部） | 立替者への支払い調整・**「表でコピー（スプレッドシート）」** |

## 未取得

- 履歴 / テンプレート画面（必要になったら追加撮影する）

## 撮り直す場合

デモデータはテンプレートに保存済み。シミュレータで目的の画面を開き、以下で撮影する。

```bash
xcrun simctl io <device-udid> screenshot <出力先>.png
```

**ホーム画面を撮り直す場合**は、クリック操作を介さずアプリを開き直すのが確実。

```bash
xcrun simctl terminate <device-udid> host.exp.Exponent
xcrun simctl openurl <device-udid> "exp://127.0.0.1:8084"
```
