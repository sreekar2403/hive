import { useCallback, useState } from "react";
import { API } from "../../lib/api";
import type { SentAttachment } from "../../state/ChatContext";

/**
 * Files staged for the next message.
 *
 * Uploaded as they are picked rather than on send, so a 4 MB screenshot is
 * already on the server by the time someone finishes typing, and a file
 * that is too large says so immediately instead of failing the message
 * after the fact.
 */

export interface PendingAttachment extends SentAttachment {
  /** Object URL for an image thumbnail; revoked when the chip is removed. */
  previewUrl?: string;
}

/** Matches MAX_ATTACHMENT_BYTES on the server, to fail before the round trip. */
const MAX_BYTES = 20 * 1024 * 1024;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

export function useAttachments() {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    setError(null);
    setUploading((n) => n + list.length);

    for (const file of list) {
      try {
        if (file.size > MAX_BYTES) {
          throw new Error(
            `${file.name} is ${Math.round(file.size / 1024 / 1024)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.`,
          );
        }

        const data = await readAsBase64(file);
        const stored = await API.post<SentAttachment>("/api/attachments", {
          name: file.name,
          mimeType: file.type,
          data,
        });

        setAttachments((prev) => [
          ...prev,
          {
            ...stored,
            previewUrl: file.type.startsWith("image/")
              ? URL.createObjectURL(file)
              : undefined,
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
  }, []);

  const remove = useCallback((id: string) => {
    setAttachments((prev) => {
      const going = prev.find((a) => a.id === id);
      // Object URLs are held by the document until revoked; dropping the
      // chip without this leaks the image for the life of the page.
      if (going?.previewUrl) URL.revokeObjectURL(going.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      return [];
    });
    setError(null);
  }, []);

  return { attachments, uploading, error, add, remove, clear };
}
