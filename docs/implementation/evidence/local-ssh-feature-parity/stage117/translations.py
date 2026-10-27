from pathlib import Path
import json
ids=['--namespace browser opening requires --operation-id','Inspect operation {operationId} with browser operation-status before opening another browser pane.']
translations={
'zh-CN':['使用 --namespace 打开浏览器时需要 --operation-id','打开另一个浏览器窗格前，请使用 browser operation-status 检查操作 {operationId}。'],
'zh-TW':['使用 --namespace 開啟瀏覽器時需要 --operation-id','開啟另一個瀏覽器窗格前，請使用 browser operation-status 檢查操作 {operationId}。'],
'ja':['--namespace でブラウザーを開くには --operation-id が必要です','別のブラウザーペインを開く前に、browser operation-status で操作 {operationId} を確認してください。'],
'ko':['--namespace로 브라우저를 열려면 --operation-id가 필요합니다','다른 브라우저 창을 열기 전에 browser operation-status로 작업 {operationId}을 확인하세요.'],
'fr':['L’ouverture du navigateur avec --namespace nécessite --operation-id','Vérifiez l’opération {operationId} avec browser operation-status avant d’ouvrir un autre volet de navigateur.'],
'de':['Das Öffnen des Browsers mit --namespace erfordert --operation-id','Prüfen Sie den Vorgang {operationId} mit browser operation-status, bevor Sie einen weiteren Browserbereich öffnen.'],
'es':['Abrir el navegador con --namespace requiere --operation-id','Consulta la operación {operationId} con browser operation-status antes de abrir otro panel de navegador.'],
'pt-BR':['Abrir o navegador com --namespace requer --operation-id','Consulte a operação {operationId} com browser operation-status antes de abrir outro painel de navegador.'],
'it':['L’apertura del browser con --namespace richiede --operation-id','Controlla l’operazione {operationId} con browser operation-status prima di aprire un altro pannello del browser.'],
'ru':['Для открытия браузера с --namespace требуется --operation-id','Перед открытием другой панели браузера проверьте операцию {operationId} с помощью browser operation-status.'],
 'tr':['--namespace ile tarayıcı açmak --operation-id gerektirir','Başka bir tarayıcı bölmesi açmadan önce {operationId} işlemini browser operation-status ile inceleyin.'],
'pl':['Otwarcie przeglądarki z --namespace wymaga --operation-id','Przed otwarciem kolejnego panelu przeglądarki sprawdź operację {operationId} za pomocą browser operation-status.'],
'nl':['Een browser openen met --namespace vereist --operation-id','Controleer bewerking {operationId} met browser operation-status voordat je een nieuw browserpaneel opent.'],
'id':['Membuka browser dengan --namespace memerlukan --operation-id','Periksa operasi {operationId} dengan browser operation-status sebelum membuka panel browser lain.'],
'cs':['Otevření prohlížeče s --namespace vyžaduje --operation-id','Před otevřením dalšího panelu prohlížeče zkontrolujte operaci {operationId} pomocí browser operation-status.'],
'vi':['Mở trình duyệt với --namespace yêu cầu --operation-id','Kiểm tra thao tác {operationId} bằng browser operation-status trước khi mở ngăn trình duyệt khác.'],
}
for locale,values in translations.items():
 p=Path('/workspace/superset/packages/i18n/locales')/locale/'messages.po';s=p.read_text()
 for msg,val in zip(ids,values):
  key='msgid '+json.dumps(msg,ensure_ascii=False)+'\nmsgstr ""';assert key in s,(locale,msg)
  s=s.replace(key,'msgid '+json.dumps(msg,ensure_ascii=False)+'\nmsgstr '+json.dumps(val,ensure_ascii=False),1)
 p.write_text(s)
print('Translated two messages for 16 locales; English generated from source')
