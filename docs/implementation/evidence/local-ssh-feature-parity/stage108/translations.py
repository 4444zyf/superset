from pathlib import Path
import json
ids=['--namespace evaluation requires --operation-id','Inspect operation {operationId} with browser operation-status before issuing another evaluation.']
translations={
'zh-CN':['使用 --namespace 求值时需要 --operation-id','再次求值前，请使用 browser operation-status 检查操作 {operationId}。'],
'zh-TW':['使用 --namespace 求值時需要 --operation-id','再次求值前，請使用 browser operation-status 檢查操作 {operationId}。'],
'ja':['--namespace での評価には --operation-id が必要です','別の評価を実行する前に、browser operation-status で操作 {operationId} を確認してください。'],
'ko':['--namespace 평가에는 --operation-id가 필요합니다','다른 평가를 실행하기 전에 browser operation-status로 작업 {operationId}을 확인하세요.'],
'fr':['L’évaluation avec --namespace nécessite --operation-id','Vérifiez l’opération {operationId} avec browser operation-status avant de lancer une autre évaluation.'],
'de':['Auswertung mit --namespace erfordert --operation-id','Prüfen Sie den Vorgang {operationId} mit browser operation-status, bevor Sie eine weitere Auswertung starten.'],
'es':['La evaluación con --namespace requiere --operation-id','Consulta la operación {operationId} con browser operation-status antes de iniciar otra evaluación.'],
'pt-BR':['A avaliação com --namespace requer --operation-id','Consulte a operação {operationId} com browser operation-status antes de iniciar outra avaliação.'],
'it':['La valutazione con --namespace richiede --operation-id','Controlla l’operazione {operationId} con browser operation-status prima di avviare un’altra valutazione.'],
'ru':['Для вычисления с --namespace требуется --operation-id','Перед запуском другого вычисления проверьте операцию {operationId} с помощью browser operation-status.'],
 'tr':['--namespace ile değerlendirme, --operation-id gerektirir','Başka bir değerlendirme başlatmadan önce {operationId} işlemini browser operation-status ile inceleyin.'],
'pl':['Ewaluacja z --namespace wymaga --operation-id','Przed rozpoczęciem kolejnej ewaluacji sprawdź operację {operationId} za pomocą browser operation-status.'],
'nl':['Evaluatie met --namespace vereist --operation-id','Controleer bewerking {operationId} met browser operation-status voordat je een nieuwe evaluatie start.'],
'id':['Evaluasi dengan --namespace memerlukan --operation-id','Periksa operasi {operationId} dengan browser operation-status sebelum memulai evaluasi lain.'],
'cs':['Vyhodnocení s --namespace vyžaduje --operation-id','Před zahájením dalšího vyhodnocení zkontrolujte operaci {operationId} pomocí browser operation-status.'],
'vi':['Việc đánh giá với --namespace yêu cầu --operation-id','Kiểm tra thao tác {operationId} bằng browser operation-status trước khi bắt đầu đánh giá khác.'],
}
for locale,values in translations.items():
 p=Path('/workspace/superset/packages/i18n/locales')/locale/'messages.po';s=p.read_text()
 for msg,val in zip(ids,values):
  key='msgid '+json.dumps(msg,ensure_ascii=False)+'\nmsgstr ""';assert key in s,(locale,msg)
  s=s.replace(key,'msgid '+json.dumps(msg,ensure_ascii=False)+'\nmsgstr '+json.dumps(val,ensure_ascii=False),1)
 p.write_text(s)
print('Translated two messages for 16 locales; English generated from source')
