import re, html, sys
src, out = sys.argv[1], sys.argv[2]
md = open(src, encoding='utf-8').read()
GH = 'https://github.com/badsadcode/NoorMD/blob/claude/bold-fermi-nh5owj/'
# Pictures for the web page (the release sheets), placed after the paragraphs they belong to.
figs = {
  '- *"…and a pixel art version? 😃 Sorry."*': [('img/bushes.webp', 'Bushes &amp; shrubs: 20 presets, grown like trees on many stems'), ('img/grass.webp', 'Grass, ferns and flowers: blades, heads, plumes, cattails'), ('img/card-plants.webp', 'Low-poly card plants: a few crossed planes each'), ('img/pixel-plants.webp', 'And the pixel-art versions')],
  'boost and night mode, subtitle styling and timing': [('img/video-menu.webp', 'NoorVideo’s new right-click menu')],
}
def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'<em>\1</em>', t)
    def link(m):
        text, url = m.group(1), m.group(2)
        if not re.match(r'https?://', url): url = GH + url
        return f'<a href="{url}">{text}</a>'
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link, t)
    return t
lines = md.split('\n'); body = []; i = 0; toc = []
def flush_para(buf):
    if buf: body.append('<p>' + inline(' '.join(x.strip() for x in buf)) + '</p>')
para = []
pending_figs = []
while i < len(lines):
    ln = lines[i]
    if ln.startswith('#'):
        flush_para(para); para = []
        lvl = len(ln) - len(ln.lstrip('#')); text = ln[lvl:].strip()
        if lvl == 1:   # the title and the line under it are in the page's header
            i += 1
            while i < len(lines) and not lines[i].strip(): i += 1
            while i < len(lines) and lines[i].strip(): i += 1
            continue
        slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
        if lvl == 2: toc.append((slug, text))
        body.append(f'<h{lvl} id="{slug}">{inline(text)}</h{lvl}>'); i += 1; continue
    if ln.strip() == '---': flush_para(para); para = []; body.append('<hr>'); i += 1; continue
    if ln.startswith('>'):
        flush_para(para); para = []; q = []
        while i < len(lines) and lines[i].startswith('>'): q.append(lines[i][1:].strip()); i += 1
        body.append('<blockquote><p>' + inline(' '.join(q)) + '</p></blockquote>'); continue
    if ln.startswith('|'):
        flush_para(para); para = []; rows = []
        while i < len(lines) and lines[i].startswith('|'): rows.append(lines[i]); i += 1
        cells = [[c.strip() for c in r.strip('|').split('|')] for r in rows if not re.match(r'^\|[\s\-|]+\|$', r)]
        head = cells[0]; t = ['<div class="table"><table>']
        if any(head): t.append('<thead><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in head) + '</tr></thead>')
        t.append('<tbody>' + ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>' for r in cells[1:]) + '</tbody></table></div>')
        body.append(''.join(t)); continue
    if re.match(r'^- ', ln):
        flush_para(para); para = []; items = []
        while i < len(lines) and (re.match(r'^- ', lines[i]) or lines[i].startswith('  ')):
            if lines[i].startswith('- '): items.append(lines[i][2:])
            else: items[-1] += ' ' + lines[i].strip()
            for k, f in figs.items():
                if lines[i].startswith(k): pending_figs += f
            i += 1
        body.append('<ul>' + ''.join(f'<li>{inline(x)}</li>' for x in items) + '</ul>'); continue
    if not ln.strip():
        flush_para(para); para = []
        for src_, cap in pending_figs: body.append(f'<figure><img src="{src_}" alt="{cap}" loading="lazy"><figcaption>{cap}</figcaption></figure>')
        pending_figs = []; i += 1; continue
    for k, f in figs.items():
        if k in ln: pending_figs += f
    para.append(ln); i += 1
flush_para(para)
for src_, cap in pending_figs: body.append(f'<figure><img src="{src_}" alt="{cap}" loading="lazy"><figcaption>{cap}</figcaption></figure>')
nav = ''.join(f'<a href="#{s}">{html.escape(re.split(r" — |:", t)[0])}</a>' for s, t in toc if t.startswith('Day'))
page = open(sys.argv[3], encoding='utf-8').read().replace('{{BODY}}', '\n'.join(body)).replace('{{NAV}}', nav)
open(out, 'w', encoding='utf-8').write(page)
print('ok', len(body), 'blocks')
