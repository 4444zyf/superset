from pathlib import Path
import json
ids=['--namespace browser login import with --from requires --operation-id','Inspect operation {operationId} with browser operation-status before importing logins again.']
translations={
'zh-CN':['使用 --namespace 和 --from 导入浏览器登录信息时，必须指定 --operation-id','再次导入登录信息前，请使用 browser operation-status 检查操作 {operationId}。'],
'zh-TW':['使用 --namespace 和 --from 匯入瀏覽器登入資訊時，必須指定 --operation-id','再次匯入登入資訊前，請使用 browser operation-status 檢查操作 {operationId}。'],
'ja':['--namespace と --from を使用するブラウザーのログイン情報のインポートには --operation-id が必要です','ログイン情報を再度インポートする前に、browser operation-status で操作 {operationId} を確認してください。'],
'ko':['--namespace와 --from을 사용한 브라우저 로그인 가져오기에는 --operation-id가 필요합니다','로그인을 다시 가져오기 전에 browser operation-status로 작업 {operationId}을 확인하세요.'],
'de':['Der Browser-Login-Import mit --namespace und --from erfordert --operation-id','Prüfe den Vorgang {operationId} mit browser operation-status, bevor du Logins erneut importierst.'],
'fr':['L’importation des connexions du navigateur avec --namespace et --from nécessite --operation-id','Vérifiez l’opération {operationId} avec browser operation-status avant d’importer à nouveau les connexions.'],
'es':['La importación de sesiones del navegador con --namespace y --from requiere --operation-id','Comprueba la operación {operationId} con browser operation-status antes de volver a importar las sesiones.'],
'it':['L’importazione degli accessi del browser con --namespace e --from richiede --operation-id','Controlla l’operazione {operationId} con browser operation-status prima di importare nuovamente gli accessi.'],
'pt-BR':['A importação de logins do navegador com --namespace e --from exige --operation-id','Verifique a operação {operationId} com browser operation-status antes de importar os logins novamente.'],
'ru':['Для импорта входов из браузера с --namespace и --from требуется --operation-id','Перед повторным импортом входов проверьте операцию {operationId} с помощью browser operation-status.'],
'pl':['Import danych logowania z przeglądarki przy użyciu --namespace i --from wymaga --operation-id','Przed ponownym importem danych logowania sprawdź operację {operationId} za pomocą browser operation-status.'],
'nl':['Browseraanmeldingen importeren met --namespace en --from vereist --operation-id','Controleer bewerking {operationId} met browser operation-status voordat je aanmeldingen opnieuw importeert.'],
'cs':['Import přihlášení z prohlížeče pomocí --namespace a --from vyžaduje --operation-id','Před dalším importem přihlášení zkontrolujte operaci {operationId} pomocí browser operation-status.'],
'id':['Impor login browser dengan --namespace dan --from memerlukan --operation-id','Periksa operasi {operationId} dengan browser operation-status sebelum mengimpor login lagi.'],
'tr':['--namespace ve --from ile tarayıcı oturumlarını içe aktarmak için --operation-id gerekir','Oturumları yeniden içe aktarmadan önce browser operation-status ile {operationId} işlemini kontrol edin.'],
'vi':['Nhập thông tin đăng nhập trình duyệt với --namespace và --from cần có --operation-id','Kiểm tra thao tác {operationId} bằng browser operation-status trước khi nhập lại thông tin đăng nhập.']}
root=Path('/workspace/superset/packages/i18n/locales')
for locale,texts in translations.items():
 p=root/locale/'messages.po';s=p.read_text()
 for key,text in zip(ids,texts):
  needle='msgid '+json.dumps(key,ensure_ascii=False)+'\nmsgstr ""';assert s.count(needle)==1,(locale,key)
  s=s.replace(needle,'msgid '+json.dumps(key,ensure_ascii=False)+'\nmsgstr '+json.dumps(text,ensure_ascii=False))
 p.write_text(s)
