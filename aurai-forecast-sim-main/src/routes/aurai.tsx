// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiPlus, FiTrash2, FiEdit2, FiSend, FiCpu, FiMenu, FiX } from "react-icons/fi";
import { GlassCard } from "@/components/GlassCard";
import { renderBold } from "@/lib/markdown";
import { listConversations, addConversation, deleteConversation, renameConversation, listMessages, addMessage, askAssistant } from "@/lib/db";

export default function AuraiAI() {
  const [convos, setConvos] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const [activeId, setActiveId] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPanelOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refresh = async () => {
    const list = await listConversations(); setConvos(list);
    if (!activeId && list[0]) setActiveId(list[0].id);
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (activeId) listMessages(activeId).then(setMessages); }, [activeId]);
  useEffect(() => { scroller.current?.scrollTo({ top: 99999, behavior: "smooth" }); }, [messages, sending]);

  const newChat = async () => { const id = await addConversation({ title: "New chat" }); setActiveId(id); setPanelOpen(false); refresh(); };
  const rename = async (c: any) => { const t = prompt("Rename chat", c.title); if (t) { await renameConversation(c.id, t); refresh(); } };
  const remove = async (c: any) => { await deleteConversation(c.id); if (activeId === c.id) setActiveId(null); refresh(); };

  const send = async () => {
    if (!input.trim()) return;
    const userText = input.trim();
    let cid = activeId;
    if (!cid) {
      cid = await addConversation({ title: userText.slice(0, 40) });
      setActiveId(cid);
    } else {
      // Name an untitled thread after its first message, so saved
      // conversations are identifiable in the list instead of all reading
      // "New chat".
      const convo = convos.find((c: any) => c.id === cid);
      if (convo && convo.title === "New chat") {
        await renameConversation(cid, userText.slice(0, 40));
      }
    }
    await addMessage({ conversationId: cid, role: "user", content: userText });
    setInput("");
    listMessages(cid).then(setMessages);
    setSending(true);
    try {
      const reply = await askAssistant(userText, cid);
      await addMessage({ conversationId: cid, role: "assistant", content: reply });
    } catch (e: any) {
      await addMessage({ conversationId: cid, role: "assistant", content: `Sorry — I couldn't reach the server. ${e.message}` });
    } finally {
      setSending(false);
    }
    listMessages(cid).then(setMessages);
    refresh();
  };

  const activeTitle = convos.find((c: any) => c.id === activeId)?.title;

  return (
    // The conversation list overlays the thread instead of taking a column, so
    // the chat itself gets the full width.
    <div className="relative h-[calc(100vh-7.5rem)]">
      <AnimatePresence>
        {panelOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setPanelOpen(false)}
              className="absolute inset-0 z-20 rounded-2xl bg-background/60 backdrop-blur-[2px]"
            />
            <motion.div
              key="panel"
              initial={{ x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="absolute inset-y-0 left-0 z-30 w-[280px] max-w-[85%]"
            >
              {/* `--background` is the only fully opaque surface token; `--card`
                  carries alpha, which would let the thread bleed through and
                  read as noise. */}
              <div className="bg-background border border-border rounded-2xl h-full flex flex-col p-4 shadow-2xl">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-border shrink-0">
                  <div className="text-sm font-semibold">Conversations</div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={newChat}
                      className="rounded-lg h-7 w-7 grid place-items-center text-white shrink-0"
                      style={{ background: "var(--gradient-primary)" }}
                      aria-label="New chat" title="New chat"
                    >
                      <FiPlus className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setPanelOpen(false)}
                      className="rounded-lg h-7 w-7 grid place-items-center text-muted-foreground hover:text-foreground hover:bg-accent/40"
                      aria-label="Close conversations" title="Close"
                    >
                      <FiX className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 space-y-1 overflow-auto scrollbar-thin flex-1 min-h-0">
                  {convos.length === 0 && (
                    <div className="text-xs text-muted-foreground px-1 py-3">No conversations yet.</div>
                  )}
                  {convos.map((c) => (
                    <div key={c.id}
                      className={`flex items-center justify-between rounded-xl px-3 py-2 cursor-pointer text-sm ${activeId === c.id ? "bg-primary/15" : "hover:bg-accent/30"}`}
                      onClick={() => { setActiveId(c.id); setPanelOpen(false); }}>
                      <span className="truncate">{c.title}</span>
                      <div className="flex gap-0.5 opacity-70">
                        <button onClick={(e) => { e.stopPropagation(); rename(c); }} className="p-1 hover:text-foreground"><FiEdit2 className="h-3 w-3" /></button>
                        <button onClick={(e) => { e.stopPropagation(); remove(c); }} className="p-1 hover:text-destructive"><FiTrash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <GlassCard className="flex flex-col min-h-0 h-full">
        <div className="flex items-center gap-2 pb-3 border-b border-border shrink-0">
          <button
            onClick={() => setPanelOpen(true)}
            className="rounded-lg h-8 w-8 grid place-items-center glass hover:bg-accent/40 shrink-0"
            aria-label="Show conversations" title="Conversations"
          >
            <FiMenu className="h-4 w-4" />
          </button>
          <div className="h-8 w-8 rounded-lg grid place-items-center text-white shrink-0" style={{ background: "var(--gradient-primary)" }}><FiCpu className="h-4 w-4" /></div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{activeTitle || "Aurai Assistant"}</div>
            <div className="text-[11px] text-muted-foreground">Answers from your workspace data</div>
          </div>
          <button
            onClick={newChat}
            className="ml-auto rounded-lg px-2.5 h-8 inline-flex items-center gap-1.5 text-xs font-medium text-white shrink-0"
            style={{ background: "var(--gradient-primary)" }}
          >
            <FiPlus className="h-3.5 w-3.5" /> New
          </button>
        </div>

        <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin py-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-sm text-muted-foreground mt-20">
              <div className="text-lg gradient-text font-semibold">How can I help you forecast today?</div>
              <div className="mt-2 text-xs">Try: "what should I do about this?" or "how accurate are my models?"</div>
            </div>
          )}
          {messages.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role !== "user" && (
                <div className="h-7 w-7 rounded-lg grid place-items-center text-white shrink-0 mt-0.5" style={{ background: "var(--gradient-primary)" }}>
                  <FiCpu className="h-3.5 w-3.5" />
                </div>
              )}
              {/* The assistant bubble gets a border and a raised surface so it
                  reads as a distinct card against the panel behind it. */}
              <div
                data-role={m.role}
                className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === "user"
                    ? "text-white rounded-br-md"
                    : "bg-card/90 border border-border shadow-sm rounded-bl-md"
                }`}
                style={m.role === "user" ? { background: "var(--gradient-primary)" } : undefined}
              >
                {renderBold(m.content)}
              </div>
            </motion.div>
          ))}
          {sending && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5 justify-start">
              <div className="h-7 w-7 rounded-lg grid place-items-center text-white shrink-0 mt-0.5" style={{ background: "var(--gradient-primary)" }}>
                <FiCpu className="h-3.5 w-3.5" />
              </div>
              <div className="bg-card/90 border border-border shadow-sm rounded-2xl rounded-bl-md px-4 py-3 inline-flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-muted-foreground"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </div>

        <div className="pt-3 border-t border-border shrink-0">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-card/80 p-2 focus-within:border-primary/60 transition-colors">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !sending && send()}
              disabled={sending}
              placeholder={sending ? "Aurai is thinking…" : "Ask about your datasets, forecasts or accuracy…"}
              className="flex-1 min-w-0 bg-transparent outline-none text-sm px-2 py-1.5 disabled:opacity-60"
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="rounded-xl h-9 w-9 grid place-items-center text-white shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              style={{ background: "var(--gradient-primary)" }}
              aria-label="Send message"
            >
              {sending ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }} className="h-4 w-4 rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <FiSend className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["What should I do about this?", "How accurate are my models?", "My latest forecast", "Workspace summary"].map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="text-[11px] rounded-full border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
