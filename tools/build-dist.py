# Assemble dist/: the game files plus only the three.js addons the game imports (and their deps).
#
# 注意：所有 open() 都显式用 utf-8。源码里有中文（丢词大作战的汉化），
# 而 Windows 上 Python 默认用 GBK 读文件，会直接 UnicodeDecodeError。
import re, os, shutil, glob, sys

# 让 print 在 GBK 控制台也不炸
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

root = 'vendor/three/jsm'
keep = {'.vercel', 'vercel.json', '.nojekyll', '.git'}


def read(p):
    with open(p, encoding='utf-8') as fh:
        return fh.read()


if os.path.isdir('dist'):
    for n in os.listdir('dist'):
        if n in keep: continue
        p = os.path.join('dist', n)
        shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
else:
    os.makedirs('dist')

# 1) 找出游戏真正 import 的 three addons，再递归收它们的相对依赖
need = set()
for f in glob.glob('src/**/*.js', recursive=True):
    need |= {m for m in re.findall(r"three/addons/([A-Za-z0-9_./-]+\.js)", read(f))}
need, seen = list(need), set()
while need:
    f = need.pop()
    if f in seen: continue
    seen.add(f)
    for m in re.findall(r"from\s+['\"](\.[^'\"]+)['\"]", read(os.path.join(root, f))):
        need.append(os.path.normpath(os.path.join(os.path.dirname(f), m)))

for f in seen:
    d = os.path.join('dist/vendor/three/jsm', f)
    os.makedirs(os.path.dirname(d), exist_ok=True)
    shutil.copy(os.path.join(root, f), d)

# 2) three 本体
os.makedirs('dist/vendor/three/build', exist_ok=True)
for f in ['three.module.js', 'three.core.js']:
    src = 'vendor/three/build/' + f
    if os.path.exists(src):
        shutil.copy(src, 'dist/vendor/three/build/' + f)

# 3) 游戏本体
for d in ['src', 'styles', 'assets']:
    shutil.copytree(d, 'dist/' + d)
shutil.copy('index.html', 'dist/index.html')

# 4) 静态托管需要的文件
#    .nojekyll  → GitHub Pages 跳过 Jekyll（否则 _ 开头的路径会 404）
#    _headers   → Cloudflare Pages / Netlify 的缓存策略（默认 max-age=14400 会让更新延迟 4 小时）
open('dist/.nojekyll', 'w').close()
with open('dist/_headers', 'w', encoding='utf-8') as fh:
    fh.write(
        '# 丢词大作战 — 缓存策略：代码每次都校验（改动立刻生效），静态资源长缓存。\n'
        '/*\n'
        '  Cache-Control: public, max-age=0, must-revalidate\n'
        '\n'
        '/assets/*\n'
        '  Cache-Control: public, max-age=31536000, immutable\n'
        '\n'
        '/vendor/*\n'
        '  Cache-Control: public, max-age=31536000, immutable\n'
    )

print('dist ready:', len(seen), 'addon files')
