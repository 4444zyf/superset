import os,sys,tty,termios,json,base64
f=sys.stdin.fileno();old=termios.tcgetattr(f);received=[];stage='raw'
def state():
 size=os.get_terminal_size(f);open("/tmp/probe-only.json",'w').write(json.dumps({'received':received,'stage':stage,'cols':size.columns,'rows':size.lines}))
try:
 tty.setraw(f);sys.stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b[2J\x1b[H'+"COPY SSH 中文 🙂 DONE"+'\r\nRAW AGENT CLIPBOARD');sys.stdout.flush();state()
 while True:
  data=os.read(f,4096);received.append(data.hex())
  if data==b'o':
   sys.stdout.write('\x1b]52;c;'+base64.b64encode("AGENT OSC52 中文 🙂".encode()).decode()+'\x07');sys.stdout.flush();stage='osc52'
  elif data==b'q': stage='finished';state();break
  state()
finally:
 sys.stdout.write('\x1b[?2004l\x1b[?1000l\x1b[?1006l\x1b[?1049l');sys.stdout.flush();termios.tcsetattr(f,termios.TCSADRAIN,old)
