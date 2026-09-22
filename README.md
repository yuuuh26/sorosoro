# そろそろ

「最後にやった日」から次の目安を計算する、個人用の周期管理PWAです。

- Android Chrome / GitHub Pages向け
- IndexedDBへ端末内保存
- 短期・長期の分類とホームへの自動浮上
- 実施履歴、履歴修正、Undo、一時停止
- オフライン対応

公開URL: https://yuuuh26.github.io/sorosoro/

## ローカル確認

Service Workerを含むため、ファイルを直接開かずHTTPサーバー経由で確認してください。

```bash
python3 -m http.server 4173
```
