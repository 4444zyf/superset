from pathlib import Path
import subprocess,json,re
root=Path('/workspace/superset');keys=["Copy browsing history and logins from Chrome, Brave, Arc, or another Chromium browser into Superset."]
def translation(source,key):
 for block in source.split('\n\n'):
  lines=block.splitlines()
  if 'msgid '+json.dumps(key,ensure_ascii=False) not in lines:continue
  i=next(i for i,line in enumerate(lines) if line.startswith('msgstr '));values=[lines[i].removeprefix('msgstr ')];values.extend(line for line in lines[i+1:] if line.startswith('"'));return ''.join(json.loads(value) for value in values)
 raise ValueError(key)
for p in sorted((root/'packages/i18n/locales').glob('*/messages.po')):
 old=subprocess.check_output(['git','show','HEAD:'+str(p.relative_to(root))],cwd=root,text=True);s=p.read_text()
 for key in keys:
  new=key.replace('Superset','{productName}');value=translation(old,key);assert 'Superset' in value,(p,key,value);value=value.replace('Superset','{productName}');needle='msgid '+json.dumps(new,ensure_ascii=False)+'\nmsgstr ""';
  if needle in s:s=s.replace(needle,'msgid '+json.dumps(new,ensure_ascii=False)+'\nmsgstr '+json.dumps(value,ensure_ascii=False),1)
  else:assert translation(s,new)==value,(p,new)
 p.write_text(s)
print('Restored the original localized setting sentence with explicit productName placeholder for all 17 locales')
