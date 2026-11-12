import Link from "next/link";

export default function DashboardHome() {
  return (
    <div className="space-y-4">
      <div className="max-w-xl rounded border border-border p-5">
        <h2 className="text-lg font-semibold">Knowledge Assistant</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Local company knowledge store
        </p>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          <p>
            <Link href="/dashboard/inbox" className="text-foreground underline">
              Inbox
            </Link>{" "}
            &mdash; drop files in to ingest them.
          </p>
          <p>
            <Link href="/dashboard/library" className="text-foreground underline">
              Library
            </Link>{" "}
            &mdash; browse ingested documents and access policies.
          </p>
          <p>
            <Link href="/dashboard/retrieve" className="text-foreground underline">
              Retrieve
            </Link>{" "}
            &mdash; search for passages across your knowledge base.
          </p>
          <p>
            <Link href="/dashboard/chat" className="text-foreground underline">
              Chat
            </Link>{" "}
            &mdash; ask questions with knowledge context.
          </p>
          <p>
            <Link href="/dashboard/audit" className="text-foreground underline">
              Audit
            </Link>{" "}
            &mdash; review the ingestion and access log.
          </p>
        </div>
      </div>
    </div>
  );
}
