import os,sys,tty,termios,json,time,re
f=sys.stdin.fileno();old=termios.tcgetattr(f);received=[];stage='normal';offset=100;pending=b''
def state():
 open("/tmp/probe-only.json",'w').write(json.dumps({'stage':stage,'received':received,'offset':offset}))
def screen(label):
 sys.stdout.write('\x1b[2J\x1b[H'+label+' 中文 🙂\r\n'+''.join('TUI line %03d\r\n'%i for i in range(offset,offset+11)));sys.stdout.flush()
try:
 tty.setraw(f)
 sys.stdout.write(''.join('SHELL HISTORY %03d\r\n'%i for i in range(1,201)));sys.stdout.flush();state()
 while True:
  data=os.read(f,4096);received.append(data.hex())
  pending+=data
  while pending.startswith(b'\x1b'):
   report=re.match(rb'\x1b\[<([0-9]+);[0-9]+;[0-9]+M',pending)
   if report:
    button=int(report[1]);pending=pending[report.end():]
   elif pending.startswith(b'\x1b[M') and len(pending)>=6:
    button=pending[3]-32;pending=pending[6:]
   else: break
   offset+=-1 if button==64 else 1;screen(stage+' OFFSET '+str(offset))
  if not pending.startswith(b'\x1b'): pending=b''
  if data==b'a':
   stage='alternate';sys.stdout.write('\x1b[?1049h');screen('FIRST SCREEN')
  elif data==b'n':
   stage='redraw';screen('SECOND SCREEN')
  elif data==b's':
   stage='mouse';sys.stdout.write('\x1b[?1000h\x1b[?1006h');sys.stdout.flush()
  elif data==b'r':
   stage='legacy';sys.stdout.write('\x1bc\x1b[?1049h\x1b[?1000h');screen('RESET LEGACY MOUSE')
  elif data==b'p':
   stage='pixels';sys.stdout.write('\x1b[?1006;1016h');screen('PIXEL MOUSE')
  elif data==b'q':
   stage='finished';state();break
  state()
finally:
 sys.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?1049l');sys.stdout.flush();termios.tcsetattr(f,termios.TCSADRAIN,old)
