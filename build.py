# Arma una versión de un solo archivo (para publicar como artifact o compartir suelta).
import re, pathlib
root = pathlib.Path(__file__).parent
html = (root/'index.html').read_text()
css = (root/'css/style.css').read_text()
js = ''.join((root/f'js/{n}.js').read_text()+'\n' for n in ['engine','bots','render','sound','game','tutorial'])
body = html.split('<!--BODY-START-->')[1].split('<!--BODY-END-->')[0]
head = re.search(r'<title>.*?</title>\s*<meta name="claude:viewport-fit-sides"[^>]*>', html, re.S).group(0)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts[^>]*>', html).group(0)
out = f'{head}\n{fonts}\n<style>\n{css}</style>\n{body}\n<script>\n{js}</script>\n'
(root/'dist').mkdir(exist_ok=True)
(root/'dist/mar-de-fondo.html').write_text(out)
full = f'<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n{out.replace(body, "</head><body>"+body,1)}</body></html>\n'
(root/'dist/standalone.html').write_text(full)
print(len(out))
