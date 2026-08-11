// アプリアイコン（紺 #16298C ＋ 金 #F9B818 ＋ 白）から抽出した配色。
// v1.0.1 デザイン刷新：レイアウトは変更せず、色のみをここに集約する。
export const Colors = {
  // ブランドカラー（アイコンから抽出）
  primary: '#16298C', // 紺 - ヘッダー、主要ボタン、選択状態
  primaryDark: '#0F1D66', // 濃紺 - 押下時・強調
  primaryLight: '#EEF1FB', // 薄紺 - バッジ背景、選択カードの背景

  accent: '#F9B818', // 金 - サブCTA、推奨バッジ、傾斜倍率の強調
  accentLight: '#FFF6DE', // 薄金 - バッジ背景

  // セマンティックカラー
  success: '#16A34A', // 緑 - 保存成功CTA
  successLight: '#F0FDF4',
  error: '#DC2626', // 赤 - エラー・削除
  errorLight: '#FEF2F2',
  warning: '#F2900E', // 橙 - 旧アクセント色の後継。注意喚起のみに限定使用
  warningLight: '#FFF3E0',
  info: '#16298C', // 紺（primaryと同色）- コピー・共有などの情報系アクション。モノクロマティック配色に統一
  infoLight: '#EEF1FB', // 薄紺（primaryLightと同色）

  // ニュートラル
  background: '#F4F6FB', // 画面背景
  card: '#FFFFFF',
  border: '#D8DEEF', // カード枠線・区切り線
  borderStrong: '#B7C0E0',

  text: '#161B33', // 本文・見出し
  textSecondary: '#6B7280', // 補足テキスト
  textOnPrimary: '#FFFFFF', // 紺背景上の文字
  textOnAccent: '#161B33', // 金背景上の文字
  placeholder: '#9CA3AF',
} as const
