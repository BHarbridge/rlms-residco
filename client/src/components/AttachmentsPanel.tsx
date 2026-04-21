import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Paperclip,
  Upload,
  Download,
  Trash2,
  FileText,
  FileImage,
  File,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Attachment = {
  id: number;
  entity_type: string;
  entity_id: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  uploaded_by: string | null;
  uploaded_at: string;
  notes: string | null;
};

type EntityType = "master_lease" | "rider" | "railcar";

interface Props {
  entityType: EntityType;
  entityId: number;
  /** compact=true renders as a small inline section (for use inside detail panels) */
  compact?: boolean;
}

function fileIcon(mime: string) {
  if (mime === "application/pdf") return <FileText className="h-4 w-4 text-red-400 shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage className="h-4 w-4 text-blue-400 shrink-0" />;
  return <File className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AttachmentsPanel({ entityType, entityId, compact = false }: Props) {
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const qKey = [`/api/attachments/${entityType}/${entityId}`];

  const { data: attachments = [], isLoading } = useQuery<Attachment[]>({
    queryKey: qKey,
    queryFn: () => apiRequest("GET", `/api/attachments/${entityType}/${entityId}`).then((r) => r.json()),
    enabled: entityId > 0,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // Use fetch directly for multipart — apiRequest doesn't handle FormData.
      // Get the auth token from the active Supabase session.
      const RENDER_API = (import.meta.env.VITE_API_BASE as string) || "";
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      const res = await fetch(
        `${RENDER_API}/api/attachments/${entityType}/${entityId}`,
        { method: "POST", headers, body: form }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey });
      toast({ title: "File uploaded", description: "Attachment saved successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/attachments/${id}`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey });
      toast({ title: "Attachment deleted" });
      setDeletingId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      setDeletingId(null);
    },
  });

  async function handleDownload(att: Attachment) {
    setDownloadingId(att.id);
    try {
      const res = await apiRequest("GET", `/api/attachments/${att.id}/download`);
      const { url } = await res.json();
      // Open in new tab — browser handles PDF inline, others download
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast({ title: "Download failed", description: "Could not generate download link.", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    uploadMutation.mutate(file);
  }

  const isEmpty = !isLoading && attachments.length === 0;

  return (
    <div className={compact ? "space-y-2" : "space-y-3"} data-testid="attachments-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip className={compact ? "h-3.5 w-3.5 text-muted-foreground" : "h-4 w-4 text-muted-foreground"} />
          <span className={compact ? "text-xs font-medium text-muted-foreground uppercase tracking-wider" : "text-sm font-medium text-muted-foreground uppercase tracking-wider"}>
            Documents
          </span>
          {attachments.length > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {attachments.length}
            </Badge>
          )}
        </div>
        {canEdit && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
              onChange={handleFileChange}
              data-testid="attachment-file-input"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              data-testid="attachment-upload-btn"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              {uploadMutation.isPending ? "Uploading…" : "Attach File"}
            </Button>
          </>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading…
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <p className="text-xs text-muted-foreground italic py-1">
          No documents attached.{canEdit ? " Click \"Attach File\" to upload a PDF or other document." : ""}
        </p>
      )}

      {/* File list */}
      {attachments.length > 0 && (
        <div className="space-y-1.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-card/50 px-3 py-2 group hover:border-border transition-colors"
              data-testid={`attachment-row-${att.id}`}
            >
              {fileIcon(att.mime_type)}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate leading-tight">{att.file_name}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {formatBytes(att.file_size)} · {formatDate(att.uploaded_at)}
                  {att.uploaded_by && ` · ${att.uploaded_by}`}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => handleDownload(att)}
                  disabled={downloadingId === att.id}
                  title="Download / view"
                  data-testid={`attachment-download-${att.id}`}
                >
                  {downloadingId === att.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                </Button>
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => setDeletingId(att.id)}
                    title="Delete attachment"
                    data-testid={`attachment-delete-${att.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deletingId !== null} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attachment?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the file from storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingId !== null && deleteMutation.mutate(deletingId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
