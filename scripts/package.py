"""Crea un pacchetto riproducibile includendo solo i file dell'estensione."""
from pathlib import Path
import json
import re
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
output = root / 'dist'
output.mkdir(exist_ok=True)
files = [root / 'manifest.json', root / 'LICENSE']
for folder in ('background', 'shared', 'sidepanel'):
    files.extend(f for f in (root / folder).rglob('*') if f.is_file())
files.extend(root / 'icons' / f'icon{n}.png' for n in (16, 48, 128))
for file in files:
    if file.suffix in ('.js', '.html', '.json'):
        if re.search(r'pannello\.diggio|diggio3000llm|diggio-(?:web|fast|balanced)|\bVPS\b', file.read_text(encoding='utf-8'), re.I):
            raise SystemExit(f'Riferimento infrastruttura interna nel pacchetto pubblico: {file.name}')
archive = output / f'diggio-agent-ia-{version}.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for file in sorted(files):
        entry = zipfile.ZipInfo(file.relative_to(root).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o644 << 16
        z.writestr(entry, file.read_bytes())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert 'manifest.json' in z.namelist()
print(archive)
