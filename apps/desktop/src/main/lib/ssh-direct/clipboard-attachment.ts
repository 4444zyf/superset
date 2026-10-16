import { z } from "zod";
import { MAX_ATTACHMENT_BYTES, uploadSelectedAttachment } from "./remote-files";

export async function uploadClipboardAttachment(
	controller: { assertGeneration(id: string, generation: number): void },
	manager: Parameters<typeof uploadSelectedAttachment>[0],
	payload: unknown,
) {
	const input = z
		.object({
			connectionId: z.string().uuid(),
			generation: z.number().int().positive(),
			bytes: z
				.instanceof(Uint8Array)
				.refine(
					(b) => b.byteLength > 0 && b.byteLength <= MAX_ATTACHMENT_BYTES,
				),
			fileName: z.string().min(1).max(255),
			mimeType: z.string().max(255),
		})
		.strict()
		.parse(payload);
	controller.assertGeneration(input.connectionId, input.generation);
	const attachment = await uploadSelectedAttachment(manager, input, input);
	controller.assertGeneration(input.connectionId, input.generation);
	return attachment;
}
