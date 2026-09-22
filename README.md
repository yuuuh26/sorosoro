# Soro Soro

「最後にやった日」から次の目安を計算する、個人用の周期管理PWAです。

- Android Chrome / GitHub Pages向け
- IndexedDBへ端末内保存
- 未来の予約日と、その次の周期目安を表示
- 項目ごとに優先浮上する／目安表示だけを選択
- 項目単位のプライベート設定と一時表示モード
- 実施履歴、履歴修正、Undo、一時停止
- オフライン対応

公開URL: https://yuuuh26.github.io/sorosoro/

## ローカル確認

Service Workerを含むため、ファイルを直接開かずHTTPサーバー経由で確認してください。

```bash
python3 -m http.server 4173
```
