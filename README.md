# 大学講義ノート庫

サイト本体と `notes.json` は GitHub Pages の `main` ブランチ直下から配信します。PDF は Google Drive の学年・学期・科目フォルダに置き、閲覧画面は Drive のプレビューを埋め込みます。

## ノートを追加する

1. Google Drive の該当する科目フォルダに PDF を置きます。PDF の共有設定で「一般的なアクセス」を「リンクを知っている全員」、「権限」を「閲覧者」にします。
2. Drive のリンクの `/d/` の直後にあるファイルIDをコピーし、`notes.json` の配列に1件追加します。保存して `main` に push すると、GitHub Pages に反映されます。

```json
{
  "driveFileId": "DRIVE_FILE_ID",
  "title": "講義ノートの題名",
  "subject": "科目名",
  "grade": "1年",
  "semester": "後期",
  "classSession": "第11回",
  "classDate": "2026-11-26",
  "keyTerms": ["検索キーワード"]
}
```

必須項目は `driveFileId`、`title`、`subject` です。Drive の共有リンクに `resourcekey` がある場合は、`resourceKey` も追加します。既存ノートの `id` は詳細ページのURLに使われます。

各科目フォルダには非掲載のファイルも置けます。一般公開するPDFだけに閲覧権限を付けてください。

## Discord 通知

`main` ブランチの `notes.json` に新しいノートが追加されると、GitHub Actions（`.github/workflows/notify-discord.yml`）が差分を検知して Discord へ自動通知します（既存ノートの編集や過去分の一括送信は行いません）。

### 初期設定

1. Discord の通知先チャンネルで「チャンネルを編集 → 連携サービス → ウェブフック」から Webhook を作成し、URL をコピーします。
2. このリポジトリの **Settings → Secrets and variables → Actions → New repository secret** で、名前を `DISCORD_WEBHOOK_URL`、値にコピーした Webhook URL を登録します。

### 手動通知・テスト送信

Actions タブの **Notify Discord on New Notes → Run workflow** から手動実行できます。`note_id` を空欄にすると最新1件を通知し、`dry_run` を `true` にすると Discord へ送信せずログ出力のみ確認できます。
