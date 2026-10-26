from pathlib import Path
import json
ids = [
'Operation ID (UUID)',
'--operation-id requires --namespace',
'--namespace navigation requires --operation-id',
'Inspect operation {operationId} with browser operation-status before issuing another navigation.',
'Inspect a durable namespace operation',
'Operation not found',
]
translations = {
'zh-CN':['操作 ID（UUID）','--operation-id 需要 --namespace','使用 --namespace 导航时需要 --operation-id','发起另一项导航前，请使用 browser operation-status 检查操作 {operationId}。','查看命名空间中持久记录的操作','未找到操作'],
'zh-TW':['操作 ID（UUID）','--operation-id 需要 --namespace','使用 --namespace 導覽時需要 --operation-id','發起另一項導覽前，請使用 browser operation-status 檢查操作 {operationId}。','檢視命名空間中持久記錄的操作','找不到操作'],
'ja':['操作 ID（UUID）','--operation-id には --namespace が必要です','--namespace での移動には --operation-id が必要です','別の移動を実行する前に、browser operation-status で操作 {operationId} を確認してください。','名前空間に永続記録された操作を確認','操作が見つかりません'],
'ko':['작업 ID(UUID)','--operation-id에는 --namespace가 필요합니다','--namespace 탐색에는 --operation-id가 필요합니다','다른 탐색을 실행하기 전에 browser operation-status로 작업 {operationId}을 확인하세요.','네임스페이스에 영구 기록된 작업 확인','작업을 찾을 수 없습니다'],
'fr':['ID de l’opération (UUID)','--operation-id nécessite --namespace','La navigation avec --namespace nécessite --operation-id','Vérifiez l’opération {operationId} avec browser operation-status avant de lancer une autre navigation.','Consulter une opération persistante de l’espace de noms','Opération introuvable'],
'de':['Vorgangs-ID (UUID)','--operation-id erfordert --namespace','Navigation mit --namespace erfordert --operation-id','Prüfen Sie den Vorgang {operationId} mit browser operation-status, bevor Sie eine weitere Navigation starten.','Einen dauerhaft gespeicherten Vorgang im Namensraum prüfen','Vorgang nicht gefunden'],
'es':['ID de operación (UUID)','--operation-id requiere --namespace','La navegación con --namespace requiere --operation-id','Consulta la operación {operationId} con browser operation-status antes de iniciar otra navegación.','Consultar una operación persistente del espacio de nombres','Operación no encontrada'],
'pt-BR':['ID da operação (UUID)','--operation-id requer --namespace','A navegação com --namespace requer --operation-id','Consulte a operação {operationId} com browser operation-status antes de iniciar outra navegação.','Consultar uma operação persistente do namespace','Operação não encontrada'],
'it':['ID operazione (UUID)','--operation-id richiede --namespace','La navigazione con --namespace richiede --operation-id','Controlla l’operazione {operationId} con browser operation-status prima di avviare un’altra navigazione.','Esamina un’operazione persistente del namespace','Operazione non trovata'],
'ru':['ID операции (UUID)','--operation-id требует --namespace','Для навигации с --namespace требуется --operation-id','Перед запуском другой навигации проверьте операцию {operationId} с помощью browser operation-status.','Проверить сохранённую операцию пространства имён','Операция не найдена'],
'tr':['İşlem kimliği (UUID)','--operation-id, --namespace gerektirir','--namespace ile gezinme, --operation-id gerektirir','Başka bir gezinme başlatmadan önce {operationId} işlemini browser operation-status ile inceleyin.','Ad alanındaki kalıcı olarak kaydedilen bir işlemi incele','İşlem bulunamadı'],
'pl':['Identyfikator operacji (UUID)','--operation-id wymaga --namespace','Nawigacja z --namespace wymaga --operation-id','Przed rozpoczęciem kolejnej nawigacji sprawdź operację {operationId} za pomocą browser operation-status.','Sprawdź trwale zapisaną operację przestrzeni nazw','Nie znaleziono operacji'],
'nl':['Bewerkings-ID (UUID)','--operation-id vereist --namespace','Navigatie met --namespace vereist --operation-id','Controleer bewerking {operationId} met browser operation-status voordat je een nieuwe navigatie start.','Een blijvend opgeslagen bewerking in de naamruimte bekijken','Bewerking niet gevonden'],
'id':['ID operasi (UUID)','--operation-id memerlukan --namespace','Navigasi dengan --namespace memerlukan --operation-id','Periksa operasi {operationId} dengan browser operation-status sebelum memulai navigasi lain.','Periksa operasi namespace yang tersimpan secara persisten','Operasi tidak ditemukan'],
'cs':['ID operace (UUID)','--operation-id vyžaduje --namespace','Navigace s --namespace vyžaduje --operation-id','Před zahájením další navigace zkontrolujte operaci {operationId} pomocí browser operation-status.','Zkontrolovat trvale uloženou operaci jmenného prostoru','Operace nenalezena'],
'vi':['ID thao tác (UUID)','--operation-id yêu cầu --namespace','Điều hướng với --namespace yêu cầu --operation-id','Kiểm tra thao tác {operationId} bằng browser operation-status trước khi bắt đầu điều hướng khác.','Kiểm tra thao tác được lưu bền vững trong không gian tên','Không tìm thấy thao tác'],
}
for locale, values in translations.items():
 p=Path('/workspace/superset/packages/i18n/locales')/locale/'messages.po'
 s=p.read_text()
 for msg, val in zip(ids,values):
  old='msgid '+json.dumps(msg,ensure_ascii=False)+'\nmsgstr ""'
  assert old in s,(locale,msg)
  s=s.replace(old,'msgid '+json.dumps(msg,ensure_ascii=False)+'\nmsgstr '+json.dumps(val,ensure_ascii=False),1)
 p.write_text(s)
print('Translated',len(translations),'locales,',len(ids),'messages')
