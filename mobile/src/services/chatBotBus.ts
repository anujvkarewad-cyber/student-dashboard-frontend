/**
 * Tiny bus so any screen (e.g. the Focus timer) can open the global AI
 * chat bot popup and optionally start a post-study revision round.
 */
export type ChatBotRequest = { revisionTopic?: string };

type Handler = (req: ChatBotRequest) => void;
let handler: Handler | null = null;

export const registerChatBotHandler = (fn: Handler | null) => { handler = fn; };
export const requestChatBot = (req: ChatBotRequest = {}) => { if (handler) handler(req); };
