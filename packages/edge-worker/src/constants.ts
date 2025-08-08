export const LAST_MESSAGE_MARKER = "___LAST_MESSAGE_MARKER___";

export const LAST_MESSAGE_MARKER_INSTRUCTION = `

${LAST_MESSAGE_MARKER}
IMPORTANT: When providing your final summary response, include the special marker ${LAST_MESSAGE_MARKER} at the very beginning of your message. This marker will be automatically removed before posting.`;