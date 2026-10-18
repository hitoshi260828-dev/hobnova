# BACKLOG

収束フェーズ中に発見したが、完了項目を阻害しないため修正を見送った既知の改善点
（いずれもMEDIUM/LOW、CRITICAL/HIGHではない）。

## NEWS記事生成

- **sourceUrlの実到達性チェックは「実在する」ことしか証明せず「記事内容と一致する」ことは
  証明しない**（`scripts/lib/news/research.mjs`）。無関係だが実在・TLS正当なページを誤って
  出典として採用しうる。より強い対策として、OpenAI Responses APIの
  `web_search_call.action.sources`（web_searchツールが実際に返したURL一覧）と`sourceUrl`を
  突き合わせる設計が独立レビューで推奨されている。`buildPrompt`/`researchNews`の構造変更を
  伴うため未実装。
- **sourceUrl検証で項目が除外された場合、最小項目数（3件）を満たさないまま公開PRが作られる**
  （実際にPR #69で3-6件の仕様に対し2件になった）。再試行ロジック（最小件数に満たない場合は
  再度web_searchを呼び直す等）は未実装。
- **複数日分のNEWS PRが未マージで溜まった場合、dedupは`main`上のマージ済み記事のみを見る**
  （`scripts/lib/news/dedup.mjs`）ため、未マージPR同士で同じ話題が重複しうる。自己修復的
  （次回main merge後は正しく検知する）で、本番露出・コスト問題にはならない。

## ChatGPT画像連携

- **`clearNewsDraftFlag`（`functions/_lib/cover-publish.ts`）は「NEWS記事・cover無し」を常に
  「cover待ち状態」とみなす**。編集者が別の理由（事実確認等）でcoverありの記事を
  draft:trueへ戻した場合も、次のcover追加呼び出しで意図せずdraft:falseへ戻ってしまう可能性が
  ある（現在のcover-pending運用と矛盾しない前提だが、将来NEWS編集フローが変わる場合は
  再確認が必要）。
- **download_url読み込み時、サイズ上限超過を検知した際にreaderを明示的に`cancel()`していない**
  （`functions/_lib/image-validate.ts`の`readBodyWithCap`）。`AbortController`による中断に
  依存しており、動作上の問題は確認されていないが、リソース解放としてはやや不十寧。

## GitHub Actions / 運用

- **GITHUB_TOKEN起点で作成されたPR（news-publish.mjs、cover-publish.ts経由）では
  `pr-check.yml`のrequired check「astro check & build」が自動発火しない**（GitHub Actionsの
  既知の仕様）。現在は人間が軽微なcommitをpushすることで回避している。PAT/GitHub App導入で
  解消可能だが、新規Secret導入が必要なため未対応。
- **daily-publish-checkのcronを正時→03:07へ変更したが、実際に改善したかは次回発火
  （2026-10-19 03:07 UTC以降）を待つ必要がある**（未確認）。
