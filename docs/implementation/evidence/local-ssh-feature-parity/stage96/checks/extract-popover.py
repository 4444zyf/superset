from pathlib import Path
import re
root=Path('/workspace/superset');base=next(root.glob('apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/*/hooks/usePaneRegistry/components/BrowserPane'));p=base/'components/DesignModePopover/DesignModePopover.tsx';s=p.read_text();Path('/workspace/scratch/parity-96/original-DesignModePopover.tsx').write_text(s)
a=s.index('\treturn (\n\t\t<div className="pointer-events-auto absolute z-20"');jsx=s[a:];picker=re.search(r'\t+<AgentSessionPicker\n[\s\S]*?/>' ,jsx);assert picker
jsx=jsx[:picker.start()]+'\t\t\t\t\t{agentPicker}'+jsx[picker.end():];jsx=jsx.replace('handleSubmit();','onSubmit();').replace('setComment(e.target.value);','onCommentChange(e.target.value);')
start=s.index('\tconst textareaRef =');end=s.index('\n\tconst canSubmit =',start);uihooks=s[start:end]
view='''import { Trans, useLingui } from "@lingui/react/macro";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { SquareDashedMousePointer, XIcon } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { LuArrowUp, LuLoaderCircle } from "react-icons/lu";
import type { DesignModePayload } from "shared/browser-design-mode";
import { shortDesignModeElementLabel } from "../../../../designModePrompt";

interface DesignModePopoverViewProps {
 payload: DesignModePayload;
 style: CSSProperties;
 comment: string;
 onCommentChange(comment: string): void;
 submitting: boolean;
 canSubmit: boolean;
 onSubmit(): void;
 onDismiss(): void;
 agentPicker: ReactNode;
}
const TEXTAREA_MAX_HEIGHT = 120;

export function DesignModePopoverView({payload, style, comment, onCommentChange, submitting, canSubmit, onSubmit, onDismiss, agentPicker}: DesignModePopoverViewProps) {
 const { t } = useLingui();
'''+uihooks+'\n'+jsx
v=p.parent/'components/DesignModePopoverView';v.mkdir(parents=True);(v/'DesignModePopoverView.tsx').write_text(view);(v/'index.ts').write_text('export { DesignModePopoverView } from "./DesignModePopoverView";\n')
s=s[:a]+'''\treturn (
 <DesignModePopoverView
  payload={payload} style={style} comment={comment} onCommentChange={setComment}
  submitting={submitting} canSubmit={canSubmit} onSubmit={() => {void handleSubmit();}} onDismiss={onDismiss}
  agentPicker={<AgentSessionPicker workspaceId={workspaceId} value={value} onValueChange={onValueChange} sessions={sessions} configs={configs} />}
 />
 );
}
''';s=s[:start]+s[end:a]+s[a:] if False else s
s=s.replace(uihooks,'');s=s.replace('import { Trans, useLingui }','import { useLingui }').replace('import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";\n','').replace('import { SquareDashedMousePointer, XIcon } from "lucide-react";\n','').replace('import { useEffect, useMemo, useRef, useState } from "react";','import { useMemo, useState } from "react";').replace('import { LuArrowUp, LuLoaderCircle } from "react-icons/lu";\n','').replace('\tshortDesignModeElementLabel,\n','').replace('const TEXTAREA_MAX_HEIGHT = 120;\n\n','');s='import { DesignModePopoverView } from "./components/DesignModePopoverView";\n'+s;p.write_text(s)
