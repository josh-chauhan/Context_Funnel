import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import JSZip from "jszip";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

type ImportCandidate = Omit<Conversation, "id">;


const STORAGE_KEY = "context-funnel-conversations-v1";
// Fall back to a relative URL so the dev proxy / same-origin deploy works with no config
// Vite used to keep certain variables private
const CHAT_API_URL = import.meta.env.VITE_CHAT_API_URL || "/api/chat";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Failing to [] means a bad save loses history but never bricks the app.
function readConversations(): Conversation[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Conversation[]) : [];
  } catch {
    return [];
  }
}

function makeConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    updatedAt: Date.now(),
    messages: [],
  };
}

function getMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!isRecord(content)) return "";

  const parts = content.parts;
  if (Array.isArray(parts)) {
    return parts.map((part) => typeof part === "string" ? part : "").filter(Boolean).join("\n");
  }
  return typeof content.text === "string" ? content.text : "";
}

function messagesFromExport(conversation: Record<string, unknown>): ChatMessage[] {
  const mapping = conversation.mapping;
  const rawMessages: unknown[] = [];

  if (isRecord(mapping)) {
    const nodes = Object.values(mapping).filter(isRecord);
    const byId = new Map(Object.entries(mapping));
    const currentNode = typeof conversation.current_node === "string"
      ? conversation.current_node
      : "";

    if (currentNode && byId.has(currentNode)) {
      const path: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      let nodeId: string | null = currentNode;
      while (nodeId && !seen.has(nodeId)) {
        seen.add(nodeId);
        const node = byId.get(nodeId);
        if (!isRecord(node)) break;
        path.push(node);
        nodeId = typeof node.parent === "string" ? node.parent : null;
      }
      path.reverse().forEach((node) => rawMessages.push(node.message));
    } else {
      nodes
        .map((node) => node.message)
        .filter(isRecord)
        .sort((a, b) => Number(a.create_time ?? 0) - Number(b.create_time ?? 0))
        .forEach((message) => rawMessages.push(message));
    }
  } else if (Array.isArray(conversation.messages)) {
    rawMessages.push(...conversation.messages);
  }

  return rawMessages.flatMap((raw): ChatMessage[] => {
    if (!isRecord(raw)) return [];
    const author = isRecord(raw.author) ? raw.author : {};
    const rawRole = typeof raw.role === "string" ? raw.role : author.role;
    if (rawRole !== "user" && rawRole !== "assistant") return [];

    const content = getMessageText(raw.content);
    if (!content.trim()) return [];
    return [{ role: rawRole, content }];
  });
}

function parseConversationData(data: unknown): ImportCandidate[] {
  const entries = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.conversations)
      ? data.conversations
      : [data];

  return entries.flatMap((entry): ImportCandidate[] => {
    if (!isRecord(entry)) return [];
    const messages = messagesFromExport(entry);
    if (!messages.length) return [];

    const title = typeof entry.title === "string" && entry.title.trim()
      ? entry.title.trim()
      : messages.find((message) => message.role === "user")?.content.slice(0, 60) || "Imported chat";
    const timestamp = Number(entry.update_time ?? entry.create_time ?? Date.now() / 1000);

    return [{
      title,
      updatedAt: timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp,
      messages,
    }];
  });
}

async function readImportFile(file: File): Promise<ImportCandidate[]> {
  if (file.name.toLowerCase().endsWith(".zip")) {
    const archive = await JSZip.loadAsync(file);
    const jsonFiles = Object.values(archive.files).filter((entry) =>
      !entry.dir && /(^|\/)conversations(?:-\d+)?\.json$/i.test(entry.name),
    );
    if (!jsonFiles.length) throw new Error("I couldn’t find conversations.json in that ZIP export.");

    const candidates: ImportCandidate[] = [];
    for (const jsonFile of jsonFiles) {
      const parsed: unknown = JSON.parse(await jsonFile.async("string"));
      candidates.push(...parseConversationData(parsed));
    }
    return candidates;
  }

  const parsed: unknown = JSON.parse(await file.text());
  return parseConversationData(parsed);
}

function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "upload":
      return <svg {...common}><path d="M12 16V4m-5 5 5-5 5 5" /><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" /></svg>;
    case "panel":
      return <svg {...common}><rect x="3.5" y="4" width="17" height="16" rx="2.2" /><path d="M9 4v16" /></svg>;
    case "message":
      return <svg {...common}><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z" /></svg>;
    case "arrow":
      return <svg {...common}><path d="M12 19V5m-6 6 6-6 6 6" /></svg>;
    case "spark":
      return <svg {...common}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
  }
}

function App() {
  const [conversations, setConversations] = useState<Conversation[]>(readConversations);
  const [activeId, setActiveId] = useState<string>(() => readConversations()[0]?.id ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[] | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeConversation = conversations.find((chat) => chat.id === activeId);
  const orderedConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeConversation?.messages.length, isSending]);

  function updateConversation(id: string, update: (chat: Conversation) => Conversation) {
    setConversations((items) => items.map((chat) => chat.id === id ? update(chat) : chat));
  }

  function startNewChat() {
    const chat = makeConversation();
    setConversations((items) => [chat, ...items]);
    setActiveId(chat.id);
    setDraft("");
    setError("");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImportError("");
    setImportFileName(file.name);
    setIsImporting(true);
    try {
      const candidates = await readImportFile(file);
      if (!candidates.length) {
        throw new Error("I couldn’t find any conversations with readable user and assistant messages.");
      }
      setImportCandidates(candidates);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "I couldn’t read that file.");
      setImportCandidates([]);
    } finally {
      setIsImporting(false);
    }
  }

  function importConversation(candidate: ImportCandidate) {
    const chat: Conversation = { ...candidate, id: crypto.randomUUID() };
    setConversations((items) => [chat, ...items]);
    setActiveId(chat.id);
    setImportCandidates(null);
    setImportError("");
    setError("");
  }



/** 
 * sendMessage Function:
 * Defaults to `draft` so the input box and the suggestion buttons share one/ code path.
 * Suggestions pass their own text.
 * Title is derived from the first message (truncated) to avoid a separate
 * "name this chat" step or an extra LLM call.
 * Send the FULL history on every request. LLM APIs are stateless; the server
 * has no memory of earlier turns unless we resend them.
 *
 */

  async function sendMessage(text = draft) {
    const content = text.trim();
    if (!content || isSending) return;

    let conversation = activeConversation;
    if (!conversation) {
      conversation = makeConversation();
      setConversations((items) => [conversation!, ...items]);
      setActiveId(conversation.id);
    }

    const nextMessages = [...conversation.messages, { role: "user" as const, content }];
    const title = conversation.messages.length === 0
      ? content.slice(0, 42) + (content.length > 42 ? "…" : "")
      : conversation.title;

    // Show the user's message immediately, before the server responds, so the UI feels instant.
    updateConversation(conversation.id, (chat) => ({
      ...chat,
      title,
      updatedAt: Date.now(),
      messages: nextMessages,
    }));
    setDraft("");
    setError("");
    setIsSending(true);  // Guard on isSending to prevent double-submits

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const response = await fetch(CHAT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `The chat service returned ${response.status}.`);
      }
      const data = (await response.json()) as { reply?: string };
      if (!data.reply) throw new Error("The chat service returned no reply.");

      updateConversation(conversation.id, (chat) => ({
        ...chat,
        updatedAt: Date.now(),
        messages: [...chat.messages, { role: "assistant", content: data.reply! }],
      }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Something went wrong.";
      setError(
        message.includes("Failed to fetch")
          ? "The chat API isn’t connected yet. Add a POST /api/chat endpoint that returns { reply: \"…\" }."
          : message,
      );
    } finally {  // finally, not just try: isSending must reset on success AND failure
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function resizeTextarea() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-visible" : "sidebar-hidden"}`}>
      <aside className="sidebar" aria-label="Chat sidebar">
        <div className="sidebar-top">
          <button className="brand-button" onClick={startNewChat} aria-label="Context Funnel home">
            <span className="brand-mark"><Icon name="spark" size={20} /></span>
            <span className="brand-name">Context Funneling Agent</span>
          </button>
            <button className="icon-button sidebar-collapse" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
            <Icon name="panel" />
          </button>
        </div>

        <div className="sidebar-actions">
          <button className="sidebar-action" onClick={startNewChat}>
            <Icon name="plus" /><span>New chat</span>
          </button>
          <button className="sidebar-action import-action" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
            <Icon name="upload" /><span>{isImporting ? "Importing…" : "Import chat"}</span>
          </button>
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".zip,.json,application/zip,application/json"
            onChange={(event) => void handleImportChange(event)}
            aria-label="Choose a ChatGPT export ZIP or conversations JSON file"
          />
        </div>

        <div className="history-label">Chats</div>
        <nav className="chat-history" aria-label="Chats">
          {orderedConversations.length === 0 ? (
            <div className="empty-history">Imported and new chats will appear here.</div>
          ) : orderedConversations.map((chat) => (
            <button
              className={`history-item ${chat.id === activeId ? "active" : ""}`}
              key={chat.id}
              onClick={() => { setActiveId(chat.id); setError(""); }}
              title={chat.title}
            >
              <Icon name="message" size={17} /><span>{chat.title}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <button className="icon-button open-sidebar" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
                <Icon name="panel" />
              </button>
            )}
          
          </div>
        </header>

        <section className="conversation-area" aria-live="polite">
          {!activeConversation?.messages.length ? (
            <div className="welcome-screen">
              <div className="welcome-emblem"><Icon name="spark" size={24} /></div>
              <h1>{activeConversation ? activeConversation.title : "Bring a conversation forward"}</h1>
              <p>Import a ChatGPT export to continue with its context.</p>
              <button className="welcome-import" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
                <Icon name="upload" size={17} /> Import chat
              </button>
            </div>
          ) : (
            <div className="message-list">
              {activeConversation.messages.map((message, index) => (
                <article className={`message-row ${message.role}`} key={`${activeConversation.id}-${index}`}>
                  {message.role === "assistant" && <div className="assistant-avatar"><Icon name="spark" size={16} /></div>}
                  <div className="message-content">
                    {message.role === "assistant"
                      ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      : message.content}
                  </div>
                </article>
              ))}
              {isSending && activeConversation.id === activeId && (
                <article className="message-row assistant">
                  <div className="assistant-avatar"><Icon name="spark" size={16} /></div>
                  <div className="typing-indicator" aria-label="Assistant is thinking"><i /><i /><i /></div>
                </article>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </section>

        <footer className="composer-area">
          {error && <div className="connection-error" role="status"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><Icon name="close" size={16} /></button></div>}
          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => { setDraft(event.target.value); resizeTextarea(); }}
              onKeyDown={handleKeyDown}
              placeholder="Message Context Funnel"
              rows={1}
              aria-label="Message Context Funnel"
            />
            <div className="composer-toolbar">
              <span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
              <button type="submit" className="send-button" disabled={!draft.trim() || isSending} aria-label="Send message">
                <Icon name="arrow" size={18} />
              </button>
            </div>
          </form>
          <div className="disclaimer">Imported chat history is stored in this browser.</div>
        </footer>
      </main>

      {importCandidates !== null && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setImportCandidates(null);
        }}>
          <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <div className="dialog-heading">
              <div><h2 id="import-title">Choose a conversation</h2><p>Import from {importFileName}</p></div>
              <button className="icon-button" onClick={() => setImportCandidates(null)} aria-label="Close import dialog"><Icon name="close" /></button>
            </div>
            {importError ? (
              <div className="import-error" role="alert">{importError}</div>
            ) : (
              <div className="import-list">
                {importCandidates.map((candidate, index) => (
                  <button className="import-option" key={`${candidate.title}-${index}`} onClick={() => importConversation(candidate)}>
                    <span className="import-option-icon"><Icon name="message" size={17} /></span>
                    <span className="import-option-copy"><strong>{candidate.title}</strong><small>{candidate.messages.length} messages</small></span>
                    <span className="import-option-arrow">Import</span>
                  </button>
                ))}
              </div>
            )}
            <div className="dialog-footer">The selected conversation stays in this browser until you send it to the chat service.</div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
