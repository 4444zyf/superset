import { msg } from "@lingui/core/macro";
import { isMarkdownFile } from "shared/file-types";
export const markdownPreviewLabel = msg({ message: "Preview" });
export const codeViewLabel = (filePath:string) => isMarkdownFile(filePath) ? msg({message:"Markdown"}) : msg({message:"Code"});
