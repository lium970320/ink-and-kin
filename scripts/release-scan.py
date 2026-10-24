"""按外部规则检查工作树与所有引用可达历史；输出仅含位置与类别。"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repository', default='.')
    parser.add_argument('--policy', required=True)
    parser.add_argument('--private-commits')
    parser.add_argument('--all-history', action='store_true')
    parser.add_argument('--history-only', action='store_true')
    parser.add_argument('--report')
    args = parser.parse_args()
    root = Path(args.repository).resolve()
    policy = json.loads(Path(args.policy).read_text(encoding='utf-8'))
    patterns = [(name, re.compile(value)) for name, value in policy['patterns'].items()]
    findings = []
    seen = set()
    files = set()
    commit_count = 0

    def git(*argv):
        return subprocess.check_output(['git', '-C', str(root), *argv], stderr=subprocess.PIPE)

    def inspect(name, content, origin):
        digest = hashlib.sha256(content).hexdigest()
        if (name, digest) in seen:
            return
        seen.add((name, digest))
        files.add(name)
        suffix = Path(name).suffix.lower()
        folded = name.casefold()
        for denied in policy['deniedPaths']:
            denied = denied.casefold()
            if (denied.endswith('/') and folded.startswith(denied)) or folded == denied:
                findings.append({'path': name, 'category': 'excluded-path', 'origin': origin})
        if folded.startswith('.env') and folded != '.env.example':
            findings.append({'path': name, 'category': 'environment-file', 'origin': origin})
        try:
            text = content.decode('utf-8-sig')
            if '\x00' in text:
                raise UnicodeError()
        except UnicodeError:
            text = None
        if text is None or suffix in {'.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.pdf', '.woff', '.woff2'}:
            approved = policy.get('assetHashes', {}).get(name, [])
            if isinstance(approved, str):
                approved = [approved]
            if digest not in approved:
                findings.append({'path': name, 'category': 'asset-not-approved', 'origin': origin})
        if text is None:
            return
        for category, expression in patterns:
            allowed = any(item.get('path') == name and item.get('category') == category
                          and item.get('sha256') == digest and item.get('reason')
                          for item in policy.get('allowedMatches', []))
            if allowed:
                continue
            for number, line in enumerate(text.splitlines(), 1):
                if expression.search(line):
                    findings.append({'path': name, 'line': number, 'category': category, 'origin': origin})

    if not args.history_only:
        # 待发布仓库应保持独立，不包含依赖、构建树或运行数据。
        for path in root.rglob('*'):
            rel = path.relative_to(root).as_posix()
            if rel == '.git' or rel.startswith('.git/'):
                continue
            if path.is_symlink():
                findings.append({'path': rel, 'category': 'link-not-approved', 'origin': 'worktree'})
            elif path.is_file():
                inspect(rel, path.read_bytes(), 'worktree')
    if args.all_history:
        commits = git('rev-list', '--all').decode().splitlines()
        commit_count = len(commits)
        forbidden = set(json.loads(Path(args.private_commits).read_text(encoding='utf-8'))) if args.private_commits else set()
        for commit in commits:
            if commit in forbidden:
                findings.append({'path': '(commit)', 'category': 'private-history', 'origin': commit})
        objects = {}
        for commit in commits:
            meta = git('show', '-s', '--format=%B', commit)
            inspect('(commit-message)/' + commit, meta, commit)
            for row in git('ls-tree', '-rz', commit).split(b'\x00'):
                if not row:
                    continue
                header, name = row.split(b'\t', 1)
                mode, kind, oid = header.decode().split()
                name = name.decode('utf-8')
                if kind != 'blob' or mode != '100644' and mode != '100755':
                    findings.append({'path': name, 'category': 'git-entry-not-approved', 'origin': commit})
                else:
                    objects.setdefault((oid, name), commit)
        blobs = {}
        for (oid, name), origin in objects.items():
            if oid not in blobs:
                blobs[oid] = git('cat-file', 'blob', oid)
            inspect(name, blobs[oid], origin)
    result = {'passed': not findings, 'commitCount': commit_count,
              'uniquePathCount': len(files), 'uniquePathVersions': len(seen),
              'findingCount': len(findings), 'findings': findings}
    if args.report:
        Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'findings'}, ensure_ascii=False))
    if findings:
        for item in findings[:30]:
            print(json.dumps(item, ensure_ascii=False))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('扫描未完成：' + type(error).__name__, file=sys.stderr)
        sys.exit(2)
