import subprocess


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


commits = git("rev-list", "--reverse", "HEAD").splitlines()
if len(commits) > 100:
    raise SystemExit("More than 100 commits")
for commit in commits:
    identity = git("show", "-s", "--format=%an <%ae>|%cn <%ce>", commit)
    expected = "dimakalash <355219079+dimakalash@users.noreply.github.com>"
    if identity != f"{expected}|{expected}":
        raise SystemExit(f"Unexpected identity: {commit}")
    diff = git("diff-tree", "--root", "--no-commit-id", "--numstat", "-r", commit)
    changed = 0
    for line in diff.splitlines():
        added, removed, _ = line.split("\t", 2)
        if not added.isdigit() or not removed.isdigit():
            raise SystemExit(f"Binary diff needs manual review: {commit}")
        changed += int(added) + int(removed)
    if changed > 300:
        raise SystemExit(f"Commit exceeds 300 changed lines: {commit} ({changed})")
    print(f"{commit[:7]} {changed} changed lines")
print(f"Verified {len(commits)} commits and their author/committer identity")
