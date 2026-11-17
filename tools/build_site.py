"""ساخت خودکار سایت از آرشیو و فایل‌های اسکن.

ورودی‌ها (همه داخل ریپو):
  data-in/archive.zip        آرشیو (داخلش archive.json)
  data-in/scans/scan-*.tsv   نتیجهٔ اسکن هاست‌ها
  config/publish-hosts.txt   دامنه‌هایی که لینکشان منتشر می‌شود

خروجی: public/data/index.json ، public/data/t/ ، public/data/build-report.json
(فایل‌های meta.json و featured.json و top.json و shelves.json و خود صفحه دست نمی‌خورند.)

قفل ایمنی: اگر ساخت جدید به‌طور مشکوکی کوچک‌تر از ساخت فعلی باشد، کار متوقف می‌شود و چیزی عوض نمی‌شود.
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# حداقل نسبت نتیجهٔ جدید به ساخت فعلی (کمتر از این یعنی چیزی اشتباه است)
MIN_TITLES_RATIO = 0.98
MIN_LINKS_RATIO = 0.90


def log(*a):
    print('[build]', *a, flush=True)


def read_lines(path):
    out = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            s = line.strip()
            if s and not s.startswith('#'):
                out.append(s)
    return out


def run(cmd):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    log('run:', ' '.join(cmd))
    r = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True)
    tail = (r.stdout or '').strip().splitlines()[-6:]
    for t in tail:
        print('   ', t)
    if r.returncode != 0:
        print(r.stderr[-2000:])
        raise SystemExit('FAILED: %s' % cmd[2])


def load_report(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--public', default=os.path.join(ROOT, 'public'))
    a = ap.parse_args()

    zip_path = os.path.join(ROOT, 'data-in', 'archive.zip')
    scans = sorted(glob.glob(os.path.join(ROOT, 'data-in', 'scans', 'scan*.tsv')))
    hosts_txt = os.path.join(ROOT, 'config', 'publish-hosts.txt')
    if not os.path.isfile(zip_path):
        raise SystemExit('archive.zip not found in data-in/')
    if not scans:
        raise SystemExit('no scan files in data-in/scans/')

    work = tempfile.mkdtemp(prefix='flicksy-build-')
    try:
        data = os.path.join(work, 'data')
        out = os.path.join(work, 'out')
        os.makedirs(os.path.join(data, 'overlay'))
        with zipfile.ZipFile(zip_path) as z:
            if 'archive.json' not in z.namelist():
                raise SystemExit('archive.zip has no archive.json inside')
            z.extract('archive.json', data)
        for s in scans:
            shutil.copy(s, os.path.join(data, os.path.basename(s)))
        hosts = read_lines(hosts_txt) if os.path.isfile(hosts_txt) else []
        with open(os.path.join(data, 'overlay', 'publish-hosts.json'), 'w', encoding='utf-8') as f:
            json.dump({'allowedHosts': hosts}, f)
        log('scan files:', [os.path.basename(s) for s in scans])
        log('publish hosts:', hosts)

        run([sys.executable, '-m', 'flicksy_dl.importer', '--data-dir', data])
        run([sys.executable, '-m', 'flicksy_dl.staticgen', '--data-dir', data, '--out', out, '--publish-links'])

        new = load_report(os.path.join(out, 'data', 'build-report.json'))
        old = load_report(os.path.join(a.public, 'data', 'build-report.json'))
        if not new:
            raise SystemExit('new build has no report')
        log('new build:', new.get('titles'), 'titles,', new.get('linksPublished'), 'links published')
        if old:
            log('current  :', old.get('titles'), 'titles,', old.get('linksPublished'), 'links published')
            if new['titles'] < old['titles'] * MIN_TITLES_RATIO:
                raise SystemExit('SAFETY STOP: titles dropped %s -> %s' % (old['titles'], new['titles']))
            if new['linksPublished'] < old['linksPublished'] * MIN_LINKS_RATIO:
                raise SystemExit('SAFETY STOP: links dropped %s -> %s' % (old['linksPublished'], new['linksPublished']))

        dst = os.path.join(a.public, 'data')
        os.makedirs(dst, exist_ok=True)
        shutil.rmtree(os.path.join(dst, 't'), ignore_errors=True)
        shutil.copytree(os.path.join(out, 'data', 't'), os.path.join(dst, 't'))
        for name in ('index.json', 'build-report.json'):
            shutil.copy(os.path.join(out, 'data', name), os.path.join(dst, name))
        log('OK: public/data updated')
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
