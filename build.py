#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""实验史记·马刀行 —— 单文件打包
把 index.html + css/style.css + js/*.js(含 js/data/*, js/battle/*) 内联成可直接双击运行的 HTML。
用法: python build.py
"""
# 一次性引入三个标准库模块：
#   io  ：带编码参数地读写文件（保证按 UTF-8 处理中文）；
#   os  ：路径拼接、取目录等操作系统相关的工具；
#   re  ：正则表达式，用来在 HTML 里"按模式"找标签。
import io, os, re

# ---------- 定位输入与输出 ----------
# ROOT 取"本脚本所在的目录"：__file__ 是 Python 内置变量，指向当前
# 脚本文件；os.path.abspath 把它变成绝对路径，dirname 再取到目录。
# 用绝对路径的好处：不管你在哪个文件夹里运行 python build.py，
# 都能正确找到源文件（不依赖"当前工作目录"）。
ROOT = os.path.dirname(os.path.abspath(__file__))
# SRC_HTML 是输入（源码版页面），OUT 是输出（单文件成品）的名字。
SRC_HTML = os.path.join(ROOT, 'index.html')
OUT = os.path.join(ROOT, '实验史记·马刀行.html')

# ---------- 两个"探测器"：在 HTML 里认出外部文件引用 ----------
# re.compile 把正则表达式提前编译成匹配器，可以反复使用。
# SCRIPT_RE 匹配 <script src="xxx"></script>（引 JS 文件的一整行）；
# CSS_RE    匹配 <link rel="stylesheet" href="xxx">（引 CSS 的一整行）。
# 表达式里的圆括号 () 是"捕获组"：匹配成功后 m.group(1) 能取出
# 括号里抓到的内容，也就是文件路径本身。
SCRIPT_RE = re.compile(r'<script src="([^"]+)"></script>')
CSS_RE = re.compile(r'<link rel="stylesheet" href="([^"]+)">')


def read(path):
    # 按 UTF-8 读入整个文本文件，返回一个字符串。
    # with ... as f 是 Python 的惯用法：with 块结束时文件自动关闭。
    with io.open(path, encoding='utf-8') as f:
        return f.read()


def build():
    # ---------- 主流程：把 1 个 CSS + 22 个 JS 全部"塞进"HTML ----------
    # 打包原理一句话：网页引用外部文件靠的是 <link> 和 <script src>
    # 这样的标签；把每个标签整个替换成"文件内容裹上对应的无 src 标签"
    # （CSS 用 <style>、JS 用 <script>），所有代码就搬进了同一个
    # HTML。浏览器打开它时不再需要任何外部文件——所以双击就能玩，
    # 零网络请求，也不怕文件夹里少拷了哪个 js。
    html = read(SRC_HTML)

    # 两个"替换函数"，交给下面的 re.sub 使用：re.sub 每匹配到一处
    # 引用，就调用对应函数一次，用返回值替换掉整段标签。
    # m 是匹配结果，m.group(1) 是标签里写的路径；用 os.path.join
    # 拼出文件的真实位置，read() 读出内容，裹上内联标签原位放回。
    # 替换按源文件里出现的顺序进行，所以 22 个脚本的先后次序
    # （依赖顺序）原封不动地保留。
    def css_repl(m):
        return '<style>\n' + read(os.path.join(ROOT, m.group(1))) + '\n</style>'

    def js_repl(m):
        return '<script>\n' + read(os.path.join(ROOT, m.group(1))) + '\n</script>'

    html = CSS_RE.sub(css_repl, html)
    html = SCRIPT_RE.sub(js_repl, html)

    # ---------- 打包后"体检"：不许有任何漏网的外部引用 ----------
    # leftovers：替换完之后还能搜到的残余引用（正常应为空）；
    # body_html：粗略截出 <body> 之后的部分，再单独搜一遍 src=" 字样，
    # 防止写法变体（比如内联标签上多写了 src）逃过上面的正则。
    # 发现残留就 raise SystemExit 直接报错退出——宁可不产出，
    # 也绝不生成一个会白屏的残次品。
    leftovers = SCRIPT_RE.findall(html) + CSS_RE.findall(html)
    body_html = re.split(r'<body[^>]*>', html, 1)[1] if re.search(r'<body[^>]*>', html) else html
    if leftovers or re.search(r'src=["\']', body_html):
        raise SystemExit('打包失败：仍有外部引用 %r' % leftovers)

    # ---------- 写出成品 ----------
    # 一个巨大的单文件 HTML。newline='\n' 强制统一用 \n 换行，
    # 避免 Windows 上被写成 \r\n 造成无谓的全文差异。
    # 最后打印输出路径和字节数，方便肉眼确认打包成功。
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('OK ->', OUT, len(html), 'bytes')


# Python 惯用法：只有"直接运行本文件"（python build.py）时，
# 内置变量 __name__ 才等于 '__main__'，此时才真正执行 build()；
# 若这个文件被别的脚本 import，则只提供函数、不会自动打包。
if __name__ == '__main__':
    build()
