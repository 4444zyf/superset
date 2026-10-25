export function browserDownloadServerFixture() {
	const html =
		'<br><a id="download-a" href="/owned-download?kind=a">Download A</a><br><a id="download-b" href="/owned-download?kind=b">Download B</a><br><a id="download-cancel" href="/owned-download?kind=cancel">Download to cancel</a><br><a id="download-finished" href="/owned-download?kind=finished">Download final file</a><br><a id="download-hold" href="/owned-download?kind=hold">Download across app restart</a><br><button id="release-downloads" onclick="fetch(\'/release-downloads\')">Finish transfers</button>';
	return {
		setup: [
			"import threading,urllib.parse",
			"lock=threading.Lock()",
			"release=threading.Event()",
			"hold=threading.Event()",
		],
		save: "def save():\n with lock:\n  temp=Path('browser-proof.tmp');temp.write_text(json.dumps(state));temp.replace('browser-proof.json')",
		handler: [
			"  if self.path.startswith('/owned-download?'):",
			"   kind=urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)['kind'][0]",
			"   payload=((state['marker']+'|'+kind+'|').encode())*4096",
			"   self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Cache-Control','no-store');self.send_header('Content-Disposition',\"attachment; filename*=UTF-8''\"+urllib.parse.quote('report 中文.txt'));self.send_header('Content-Length',str(len(payload)));self.end_headers()",
			"   try:",
			"    self.wfile.write(payload[:65536]);self.wfile.flush()",
			"    (hold if kind=='hold' else release).wait()",
			"    self.wfile.write(payload[65536:]);self.wfile.flush()",
			"   except (BrokenPipeError,ConnectionResetError): pass",
			"   return",
			"  if self.path.startswith('/release-downloads'):",
			"   release.set();self.send_response(200);self.send_header('Content-Length','2');self.end_headers();self.wfile.write(b'ok');return",
		],
		body: `  body+=${JSON.stringify(html)}.encode()`,
		server:
			"server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True",
		finalize:
			"finally: release.set();hold.set();server.server_close();state['running']=False;save()",
	};
}
