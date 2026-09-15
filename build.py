#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""实验史记·春秋笔 —— 单文件打包
把 index.html + css/style.css + js/*.js 内联成一个可直接双击运行的 HTML。
用法: python build.py
"""
import io, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC_HTML = os.path.join(ROOT, 'index.html')
OUT = os.path.join(ROOT, '实验史记·春秋笔.html')

SCRIPT_RE = re.compile(r'<script src="([^"]+)"></script>')
CSS_RE = re.compile(r'<link rel="stylesheet" href="([^"]+)">')


def read(path):
    with io.open(path, encoding='utf-8') as f:
        return f.read()


def build():
    html = read(SRC_HTML)

    def css_repl(m):
        return '<style>\n' + read(os.path.join(ROOT, m.group(1))) + '\n</style>'

    def js_repl(m):
        return '<script>\n' + read(os.path.join(ROOT, m.group(1))) + '\n</script>'

    html = CSS_RE.sub(css_repl, html)
    html = SCRIPT_RE.sub(js_repl, html)

    leftovers = SCRIPT_RE.findall(html) + CSS_RE.findall(html)
    body_html = re.split(r'<body[^>]*>', html, 1)[1] if re.search(r'<body[^>]*>', html) else html
    if leftovers or re.search(r'src=["\']', body_html):
        raise SystemExit('打包失败：仍有外部引用 %r' % leftovers)

    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('OK ->', OUT, len(html), 'bytes')


if __name__ == '__main__':
    build()
