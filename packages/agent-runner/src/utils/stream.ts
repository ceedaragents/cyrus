export function pipeStreamLines(
	stream: NodeJS.ReadableStream,
	handler: (line: string) => void,
): void {
	let buffer = "";
	stream.setEncoding("utf8");
	stream.on("data", (chunk: string) => {
		buffer += chunk;
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
			buffer = buffer.slice(newlineIndex + 1);
			if (line.length > 0) {
				handler(line);
			}
			newlineIndex = buffer.indexOf("\n");
		}
	});
	stream.on("end", () => {
		const remaining = buffer.replace(/\r$/, "");
		if (remaining.length > 0) {
			handler(remaining);
		}
	});
}
