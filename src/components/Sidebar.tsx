"use client";

import { ChevronLeft, ChevronRight, FileText, LogOut, Plus, Trash2 } from "lucide-react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Session = {
  id: string;
  filename: string;
  pageCount: number;
  createdAt: string;
};

type User = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export default function Sidebar({ user }: { user: User }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const params = useParams<{ id?: string }>();
  const router = useRouter();

  async function loadSessions() {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) setSessions(await res.json() as Session[]);
    } catch { /* ignore */ }
  }

  useEffect(() => { void loadSessions(); }, []);
  useEffect(() => { void loadSessions(); }, [params.id]);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("이 채팅방을 삭제할까요?")) return;
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((cur) => cur.filter((s) => s.id !== id));
    if (params.id === id) router.push("/chat");
  }

  return (
    <aside className={`sidebar${isCollapsed ? " collapsed" : ""}`}>
      <div className="sidebar-top">
        {!isCollapsed && <span className="sidebar-brand">PDF Evidence AI</span>}
        <Link href="/chat" className="sidebar-new-btn" title="새 채팅">
          <Plus size={15} />
        </Link>
        <button
          className="sidebar-collapse-btn"
          type="button"
          onClick={() => setIsCollapsed((v) => !v)}
          title={isCollapsed ? "펼치기" : "접기"}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <nav className="sidebar-list">
        {sessions.length === 0 ? (
          <p className="sidebar-empty">채팅방이 없습니다</p>
        ) : (
          sessions.map((s) => (
            <Link
              key={s.id}
              href={`/chat/${s.id}`}
              className={`sidebar-item${params.id === s.id ? " active" : ""}`}
              title={isCollapsed ? s.filename.replace(/\.pdf$/i, "") : undefined}
            >
              <FileText size={14} className="sidebar-item-icon" />
              <span className="sidebar-item-name">{s.filename.replace(/\.pdf$/i, "")}</span>
              <button
                className="sidebar-del-btn"
                type="button"
                title="삭제"
                onClick={(e) => void handleDelete(e, s.id)}
              >
                <Trash2 size={12} />
              </button>
            </Link>
          ))
        )}
      </nav>

      <div className="sidebar-footer">
        {user.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt={user.name ?? ""} className="sidebar-avatar" referrerPolicy="no-referrer" />
        )}
        {!isCollapsed && (
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user.name ?? user.email}</span>
          </div>
        )}
        <button
          className="sidebar-logout"
          type="button"
          title="로그아웃"
          onClick={() => void signOut({ callbackUrl: "/login" })}
        >
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
}
