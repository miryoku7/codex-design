# ソースの配布

## リポジトリの範囲

ローカルのデザインライブラリ、単独ワークベンチ、Codex Skill、CLI、テスト、文書を同じGitリポジトリで管理します。アプリとSkillを同じ版で取得・更新するためのmonorepoです。

```text
codex-design/
├── src/                  ライブラリAPI・保存処理
├── web/                  ライブラリ画面
├── migrations/           ローカルD1の移行
├── skills/design-workbench/  制作Skill・単独ワークベンチ・サンプル
├── scripts/              ライブラリCLI・補助処理
├── tests/
├── docs/
├── README.md
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

ソースと同梱サンプルは [MIT License](../LICENSE) で提供します。モデルへのアクセスや画像生成サービスは含みません。必要な環境と導入手順は [README](../README.md)、検証した範囲は [VERIFICATION.md](../VERIFICATION.md) にあります。

## 配布に含めるもの

Gitで追跡するコード、Skill全体、同梱サンプル、テスト、文書、`package-lock.json`、ライセンスと第三者ソフトウェアの情報を含めます。ライブラリのCLIはSkillディレクトリの外にあるため、ソース一式のディレクトリ構造を保ってください。

利用者の作品・画像原本を置く `.design-workbench/`、ローカルDBの `.wrangler/`、`.env*`・`.dev.vars*`、個人のブラウザ状態は配布しません。`node_modules/`、`.generated/`、`dist/`、ログ・キャッシュもGit管理外です。依存は利用者が `npm ci` で取得します。

バイナリ、コンテナ、依存入りアーカイブなどへ配布形式を変える場合は、[第三者ソフトウェアの情報](../THIRD_PARTY_NOTICES.md)を確認し、実際の同梱物の条件を満たしてください。

## ソースアーカイブを作る

公開するコミットを確定し、リポジトリのルートで実行します。以下は `HEAD` の追跡ファイルだけを収録します。Git履歴、未コミット変更、Git管理外の作品・DBは含みません。

```sh
mkdir -p dist
git archive --format=tar.gz --prefix=codex-design-0.1.0/ --output=dist/codex-design-0.1.0-source.tar.gz HEAD
python3 - <<'PY'
from pathlib import Path
import hashlib

archive = Path("dist/codex-design-0.1.0-source.tar.gz")
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(archive.suffix + ".sha256").write_text(f"{digest}  {archive.name}\n")
print(digest)
PY
```

別の版を配布するときは、アーカイブ名と展開先のバージョンをそろえます。展開したファイルが対象コミットと一致し、READMEの導入手順で動くことを確認してください。

Gitリポジトリとして配布する場合は、この公開用リポジトリの履歴を使います。公開前の私的な作業履歴・バックアップを持ち込まないでください。公開後の変更は通常のコミットとして記録します。

## 公開操作

ローカルのコミットやアーカイブの作成は、GitHubリポジトリの作成・公開、push、タグやリリースの公開、npm公開、クラウド資源の作成・デプロイとは別の操作です。公開先と対象の版を確定してから実行してください。
