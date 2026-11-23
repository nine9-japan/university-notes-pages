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
