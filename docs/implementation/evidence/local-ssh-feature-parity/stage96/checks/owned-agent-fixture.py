import os,sys,json,re,hashlib,base64,struct,termios,tty,urllib.request,urllib.parse,uuid
from pathlib import Path
root=Path(sys.argv[2]).resolve()
assert Path.cwd().resolve()==root and os.environ.get('SUPERSET_WORKSPACE_ID')==sys.argv[1]
terminal=os.environ['SUPERSET_TERMINAL_ID'];hook=os.environ['SUPERSET_HOST_AGENT_HOOK_URL'];u=urllib.parse.urlparse(hook)
assert u.scheme=='http' and u.hostname=='127.0.0.1' and u.path=='/trpc/notifications.hook'
marker='OWNED-DESIGN-'+str(uuid.uuid4());launch='owned-'+str(uuid.uuid4());session='owned-'+str(uuid.uuid4())
proof=root/'.superset/owned-design-received.json';state={'marker':marker,'terminalId':terminal,'pid':os.getpid(),'cwd':str(root),'launchId':launch,'sessionId':session,'running':True,'feedbacks':[]}
def save():
 temp=proof.with_suffix('.tmp');temp.write_text(json.dumps(state));temp.replace(proof)
def notify(event):
 body={'json':{'terminalId':terminal,'eventType':event,'launchId':launch,'agent':{'agentId':'claude','sessionId':session}}}
 request=urllib.request.Request(hook,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='POST')
 with urllib.request.urlopen(request,timeout=5) as response:
  data=json.load(response)['result']['data']['json'];assert data['success'] and not data.get('ignored',False)
def record(prompt,transport,raw=None):
 row={'prompt':prompt,'transport':transport,'files':[]}
 if raw is not None:row['rawBase64']=base64.b64encode(raw).decode()
 for relative in sorted(set(re.findall(r'\.superset/attachments/design-[\w.-]+\.(?:md|png)',prompt))):
  path=(root/relative).resolve();assert path.parent==root/'.superset/attachments';data=path.read_bytes()
  item={'relative':relative,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
  if path.suffix=='.md':item['text']=data.decode()
  else:
   assert data[:8]==b'\x89PNG\r\n\x1a\n';item['width'],item['height']=struct.unpack('>II',data[16:24])
   if len(data)<=65536:item['base64']=base64.b64encode(data).decode()
  row['files'].append(item)
 assert any(item['relative'].endswith('.md') for item in row['files']);state['feedbacks'].append(row);save()
notify('Attached');record(sys.argv[3],'argv')
fd=sys.stdin.fileno();old=termios.tcgetattr(fd)
try:
 tty.setraw(fd);sys.stdout.write('\x1b[?1049h\x1b[?2004l\x1b[2J\x1b[HOWNED DESIGN AGENT\r\nSynthetic TUI, ready for feedback.\r\n');sys.stdout.flush();buffer=b''
 while True:
  chunk=os.read(fd,4096)
  if not chunk or b'\x03' in chunk:break
  buffer+=chunk
  if b'\r' not in buffer:continue
  raw,buffer=buffer.split(b'\r',1);assert raw.startswith(b'\x1b[200~') and raw.endswith(b'\x1b[201~')
  record(raw[6:-6].decode(),'pty',raw);sys.stdout.write('Feedback received.\r\n');sys.stdout.flush()
finally:
 termios.tcsetattr(fd,termios.TCSADRAIN,old);sys.stdout.write('\x1b[?1049l');sys.stdout.flush();notify('Detached');state['running']=False;save()
