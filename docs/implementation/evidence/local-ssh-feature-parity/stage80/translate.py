from pathlib import Path
import json
keys=['Browser settings are invalid. Restore defaults to continue.','Applies to URLs in terminals.']
rows={
'ja':['ブラウザー設定が無効です。続行するには既定値に戻してください。','ターミナル内の URL に適用されます。'],
'zh-CN':['浏览器设置无效。请恢复默认设置后继续。','适用于终端中的 URL。'],
'fr':['Les paramètres du navigateur sont invalides. Rétablissez les valeurs par défaut pour continuer.','S’applique aux URL dans les terminaux.'],
'ko':['브라우저 설정이 잘못되었습니다. 계속하려면 기본값을 복원하세요.','터미널의 URL에 적용됩니다.'],
'zh-TW':['瀏覽器設定無效。請還原預設值後繼續。','適用於終端機中的 URL。'],
'es':['La configuración del navegador no es válida. Restablece los valores predeterminados para continuar.','Se aplica a las URL en terminales.'],
'de':['Die Browsereinstellungen sind ungültig. Stelle die Standardwerte wieder her, um fortzufahren.','Gilt für URLs in Terminals.'],
'pt-BR':['As configurações do navegador são inválidas. Restaure os padrões para continuar.','Aplica-se a URLs em terminais.'],
'it':['Le impostazioni del browser non sono valide. Ripristina i valori predefiniti per continuare.','Si applica agli URL nei terminali.'],
'ru':['Настройки браузера недействительны. Восстановите значения по умолчанию, чтобы продолжить.','Применяется к URL в терминалах.'],
'tr':['Tarayıcı ayarları geçersiz. Devam etmek için varsayılanları geri yükleyin.','Terminallerdeki URL’ler için geçerlidir.'],
'pl':['Ustawienia przeglądarki są nieprawidłowe. Przywróć ustawienia domyślne, aby kontynuować.','Dotyczy adresów URL w terminalach.'],
'nl':['De browserinstellingen zijn ongeldig. Herstel de standaardwaarden om door te gaan.','Van toepassing op URL’s in terminals.'],
'id':['Pengaturan browser tidak valid. Pulihkan pengaturan default untuk melanjutkan.','Berlaku untuk URL di terminal.'],
'cs':['Nastavení prohlížeče je neplatné. Chcete-li pokračovat, obnovte výchozí hodnoty.','Platí pro adresy URL v terminálech.'],
'vi':['Cài đặt trình duyệt không hợp lệ. Hãy khôi phục mặc định để tiếp tục.','Áp dụng cho URL trong cửa sổ dòng lệnh.']}
for locale,values in rows.items():
 p=Path('/workspace/superset/packages/i18n/locales')/locale/'messages.po';s=p.read_text()
 for key,value in zip(keys,values):
  old='msgid '+json.dumps(key,ensure_ascii=False)+'\nmsgstr ""'
  assert s.count(old)==1,(locale,key)
  s=s.replace(old,'msgid '+json.dumps(key,ensure_ascii=False)+'\nmsgstr '+json.dumps(value,ensure_ascii=False))
 p.write_text(s)
