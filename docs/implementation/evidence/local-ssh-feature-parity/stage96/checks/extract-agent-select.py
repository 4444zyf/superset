from pathlib import Path
import re
root=Path('/workspace/superset');base=root/'apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/AgentSessionPicker/components'
for name in ['ExistingSessionOption','NewSessionOption']:
 p=base/name/(name+'.tsx');s=p.read_text();Path('/workspace/scratch/parity-96/original-'+name+'.tsx').write_text(s)
 # Keep the original option markup, injecting just the icon.
 prop_type='ExistingSessionOptionViewProps' if name.startswith('Existing') else 'NewSessionOptionViewProps'
 decl=s.index('export function '); sig=s.index('}: {',decl);end=s.index('}) {',sig)
 props=s[sig+4:end]+'\ticonSrc?: string;\n'
 original_destructure=s[decl+len('export function '+name+'({'):sig]
 body=s[end+4:];body=re.sub(r'\n\tconst iconSrc = usePresetIcon\([^\n]+\);','',body,count=1)
 imports=s[:decl].replace('import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";\n','')
 view=imports+'export interface '+prop_type+' {'+props+'}\n\nexport function '+name+'View({'+original_destructure+'\ticonSrc,\n}: '+prop_type+') {'+body
 v=p.parent/'components'/(name+'View');v.mkdir(parents=True);(v/(name+'View.tsx')).write_text(view);(v/'index.ts').write_text('export { '+name+'View, type '+prop_type+' } from "./'+name+'View";\n')
 key='binding.agentId' if name.startswith('Existing') else 'presetId'
 p.write_text('import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";\nimport { '+name+'View, type '+prop_type+' } from "./components/'+name+'View";\n\nexport function '+name+'(props: Omit<'+prop_type+', "iconSrc">) {\n const iconSrc = usePresetIcon(props.'+key+');\n return <'+name+'View {...props} iconSrc={iconSrc} />;\n}\n')
p=base/'AgentSessionSelect/AgentSessionSelect.tsx';s=p.read_text();Path('/workspace/scratch/parity-96/original-AgentSessionSelect.tsx').write_text(s)
s=s.replace('import { ExistingSessionOption } from "../ExistingSessionOption";','import type { ExistingSessionOptionViewProps } from "../../../ExistingSessionOption/components/ExistingSessionOptionView";').replace('import { NewSessionOption } from "../NewSessionOption";','import type { NewSessionOptionViewProps } from "../../../NewSessionOption/components/NewSessionOptionView";')
s=s.replace('from "../../hooks/','from "../../../../hooks/')
s=s.replace('interface AgentSessionSelectProps {','export interface AgentSessionSelectViewProps {\n renderExisting(props: ExistingSessionOptionViewProps): React.ReactNode;\n renderNew(props: NewSessionOptionViewProps): React.ReactNode;')
s=s.replace('export function AgentSessionSelect({','export function AgentSessionSelectView({\n renderExisting, renderNew,').replace('}: AgentSessionSelectProps)', '}: AgentSessionSelectViewProps)')
for tag,fn in [('ExistingSessionOption','renderExisting'),('NewSessionOption','renderNew')]:
 pattern=r'<'+tag+r'\s+([\s\S]*?)/>'
 def replace(match):
  text=match.group(1); attrs=[]
  # All original option attributes use balanced JSX expressions.
  i=0
  while i<len(text):
   while i<len(text) and text[i].isspace():i+=1
   if i>=len(text):break
   m=re.match(r'(\w+)\s*=\s*\{',text[i:]);assert m,text[i:];name=m.group(1);start=i+m.end();depth=1;j=start
   while depth:
    if text[j]=='{':depth+=1
    elif text[j]=='}':depth-=1
    j+=1
   attrs.append(name+': '+text[start:j-1]);i=j
  return '{'+fn+'({'+', '.join(attrs)+'})}'
 s=re.sub(pattern,replace,s)
v=p.parent/'components/AgentSessionSelectView';v.mkdir(parents=True);(v/'AgentSessionSelectView.tsx').write_text(s);(v/'index.ts').write_text('export { AgentSessionSelectView, type AgentSessionSelectViewProps } from "./AgentSessionSelectView";\n')
p.write_text('''import { ExistingSessionOption } from "../ExistingSessionOption";
import { NewSessionOption } from "../NewSessionOption";
import { AgentSessionSelectView, type AgentSessionSelectViewProps } from "./components/AgentSessionSelectView";

type AgentSessionSelectProps = Omit<AgentSessionSelectViewProps, "renderExisting" | "renderNew">;
export function AgentSessionSelect(props: AgentSessionSelectProps) {
 return <AgentSessionSelectView {...props}
  renderExisting={(option) => <ExistingSessionOption {...option} />}
  renderNew={(option) => <NewSessionOption {...option} />}
 />;
}
''')
