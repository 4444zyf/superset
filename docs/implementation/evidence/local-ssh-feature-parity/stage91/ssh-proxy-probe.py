import os,json,socket,hashlib
from pathlib import Path
from urllib.parse import urlparse
policy=json.loads(Path('/etc/codex/network-policy.json').read_text());assert policy['version']==1
report={'policyVersion':1,'vpnConfigured':policy.get('vpn_configured'),'tcpDomainGrantCount':len(policy.get('tcp_network_access',{}).get('domains',[])),'tcpIpGrantCount':len(policy.get('tcp_network_access',{}).get('ip_ranges',[])),'usedConfiguredTcpProxy':True,'sentPassword':False,'ranRemoteCommands':False}
try:
 host=os.environ['SUPERSET_SSH_HOST'];port=int(os.environ['SUPERSET_SSH_PORT']);assert host and not any(c in host for c in '\r\n\x00') and 1<=port<=65535
 proxy=urlparse(policy['tcp_connect_proxy']);assert proxy.scheme=='http' and proxy.hostname and proxy.port
 target=('['+host+']' if ':' in host and not host.startswith('[') else host)+':'+str(port)
 with socket.create_connection((proxy.hostname,proxy.port),timeout=5) as conn:
  conn.settimeout(5);conn.sendall(('CONNECT '+target+' HTTP/1.1\r\nHost: '+target+'\r\n\r\n').encode('ascii'))
  first=b''
  while b'\r\n' not in first and len(first)<8192:
   chunk=conn.recv(1024)
   if not chunk:break
   first+=chunk
  parts=first.split(b'\r\n',1)[0].split(b' ');report['httpConnectStatus']=int(parts[1]) if len(parts)>1 and parts[1].isdigit() else None
  report['tunnelEstablished']=report['httpConnectStatus']==200
except Exception as error:report['errorType']=type(error).__name__
p=Path('/workspace/scratch/parity-91/ssh-proxy-probe.json');p.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
