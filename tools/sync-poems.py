#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从内容仓同步诗库快照到游戏仓库。

内容仓（GitHub: diuci/k12-chinese-poetry）是诗文内容的**唯一事实源**；
本仓库只保留一份构建产物快照，供游戏运行时 import。

流程：
    内容仓 poems/*.md
      → python tools/build.py            （内容仓侧，生成 data/poems.json）
      → python tools/sync-poems.py       （本脚本，拷进游戏仓）
      → npm run test-poems              （验证联句等机制仍正确）

用法：
    python tools/sync-poems.py# 从 ../k12-chinese-poetry 同步
    python tools/sync-poems.py --check  # 只比对，不拷贝（CI 用）
    python tools/sync-poems.py --remote https://github.com/diuci/k12-chinese-poetry.git
"""

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'src' / 'game' / 'poems' / 'data'
DEFAULT_SRC = ROOT.parent / 'k12-chinese-poetry'
REMOTE = 'https://github.com/diuci/k12-chinese-poetry.git'


def die(msg):
    print('[sync] ERROR: ' + msg, file=sys.stderr)
    sys.exit(1)


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load_src(use_remote):
    """返回 (src_dir, 是否临时克隆)。"""
    if not use_remote:
        if not DEFAULT_SRC.exists():
            die('找不到内容仓 %s\n可用 --remote 从 GitHub 拉取' % DEFAULT_SRC)
        return DEFAULT_SRC, False
    tmp = Path(tempfile.mkdtemp(prefix='kebiaoyuwen-'))
    print('[sync] 从 %s 克隆…' % REMOTE)
    r = subprocess.run(['git', 'clone', '--depth', '1', REMOTE, str(tmp / 'repo')],
                       capture_output=True, text=True)
    if r.returncode != 0:
        die('克隆失败：\n' + r.stderr)
    return tmp / 'repo', True


def main():
    check = '--check' in sys.argv
    use_remote = '--remote' in sys.argv

    src, _tmp = load_src(use_remote)

    # 内容仓侧先构建，保证快照与md 一致
    built = src / 'data' / 'poems.json'
    if not built.exists() or src == DEFAULT_SRC:
        print('[sync] 在内容仓执行 build.py …')
        r = subprocess.run([sys.executable, 'tools/build.py'], cwd=src,
                           capture_output=True, text=True, encoding='utf-8')
        if r.returncode != 0:
            die('内容仓构建失败：\n' + (r.stderr or r.stdout))
        print('       ' + r.stdout.strip().splitlines()[0])

    if not built.exists():
        die('内容仓没有 data/poems.json')

    src_sum = src / 'data' / 'checksums.json'
    if not src_sum.exists():
        die('内容仓没有 data/checksums.json')

    DEST.mkdir(parents=True, exist_ok=True)
    pairs = [(built, DEST / 'poems.json'), (src_sum, DEST / 'checksums.json')]

    if check:
        diff = []
        for s, d in pairs:
            if not d.exists():
                diff.append('%s 缺失' % d.name)
            elif sha(s) != sha(d):
                diff.append('%s 内容不同' % d.name)
        if diff:
            print('[sync] ✗ 快照与内容仓不一致：')
            for x in diff:
                print('       ' + x)
            print('       跑 python tools/sync-poems.py 同步')
            return 1
        print('[sync] ✓ 快照与内容仓一致')
        return 0

    for s, d in pairs:
        # 顺带把 build.py 用的 md 拷进游戏仓？不需要——游戏只要 json。
        d.write_bytes(s.read_bytes())
        print('[sync] %s  %s' % (d.name, sha(d)[:12]))

    n = json.loads((DEST / 'poems.json').read_text(encoding='utf-8'))
    print('[sync] %d 篇，内容版本 %s' % (n['count'], n['contentVersion']))
    print('[sync] 下一步：npm run test-poems')
    return 0


if __name__ == '__main__':
    sys.exit(main())
