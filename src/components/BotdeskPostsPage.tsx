"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { InlineUrlButton, ChannelPermissionResult } from "@/lib/post-service";
import {
  COMMON_TIMEZONES,
  formatScheduledDisplay,
  validateAndParseZonedDateTime,
  validateFutureSchedule,
} from "@/lib/schedule-utils";
import { safeFetchJson } from "@/lib/api-client";

export interface BotOption {
  id: string;
  name: string;
  username: string;
}

export interface ChannelOption {
  id: string;
  botId: string;
  name: string;
  telegramChatId: string;
}

export interface AlbumItemDTO {
  id?: string;
  mediaType: "IMAGE" | "VIDEO";
  filePath: string;
  originalName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  order: number;
  hasSpoiler?: boolean;
}

export interface PostItemDTO {
  id: string;
  botId: string;
  channelId: string;
  channelName?: string;
  channelChatId?: string;
  postType: "TEXT" | "IMAGE" | "VIDEO" | "ALBUM";
  content: string;
  mediaPath?: string | null;
  mediaOriginalName?: string | null;
  mediaMimeType?: string | null;
  mediaSizeBytes?: number | null;
  albumItems?: AlbumItemDTO[] | null;
  albumMessageIds?: number[] | null;
  buttonMessageId?: number | null;
  buttonsConfig?: InlineUrlButton[] | null;
  disableNotification?: boolean;
  hasSpoiler?: boolean;
  sendAsDocument?: boolean;
  status:
    | "DRAFT"
    | "SCHEDULED"
    | "SENDING"
    | "PUBLISHED"
    | "FAILED"
    | "UNKNOWN"
    | "PARTIAL";
  scheduledAt?: string | null;
  scheduledTimezone?: string | null;
  scheduledByUserId?: string | null;
  telegramMessageId?: number | null;
  lastError?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BotdeskPostsPageProps {
  bots: BotOption[];
  initialBotId: string;
  channelsByBot: Record<string, ChannelOption[]>;
  initialPosts: PostItemDTO[];
}

function getDateAndTimeInZone(date: Date, timeZone: string) {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const getVal = (t: string) => parts.find((p) => p.type === t)?.value || "";
    let hour = getVal("hour");
    if (hour === "24") hour = "00";
    return {
      date: `${getVal("year")}-${getVal("month")}-${getVal("day")}`,
      time: `${hour}:${getVal("minute")}`,
    };
  } catch {
    const iso = date.toISOString();
    return {
      date: iso.slice(0, 10),
      time: iso.slice(11, 16),
    };
  }
}

export function BotdeskPostsPage({
  bots,
  initialBotId,
  channelsByBot,
  initialPosts,
}: BotdeskPostsPageProps) {
  const router = useRouter();

  // Selection state
  const [selectedBotId, setSelectedBotId] = useState<string>(initialBotId);
  const channels = channelsByBot[selectedBotId] || [];
  const [selectedChannelId, setSelectedChannelId] = useState<string>(
    channels[0]?.id || ""
  );

  // When bot changes, reset selected channel
  useEffect(() => {
    const available = channelsByBot[selectedBotId] || [];
    if (available.length > 0) {
      if (!available.some((c) => c.id === selectedChannelId)) {
        setSelectedChannelId(available[0].id);
      }
    } else {
      setSelectedChannelId("");
    }
  }, [selectedBotId, channelsByBot]);

  const activeBot = bots.find((b) => b.id === selectedBotId) || bots[0];
  const activeChannel = channels.find((c) => c.id === selectedChannelId);

  // Channel Permission check state
  const [permissionCheck, setPermissionCheck] = useState<
    ChannelPermissionResult | null
  >(null);
  const [checkingPermission, setCheckingPermission] = useState(false);

  useEffect(() => {
    if (!selectedBotId || !selectedChannelId) {
      setPermissionCheck(null);
      return;
    }

    let isMounted = true;
    setCheckingPermission(true);

    fetch(
      `/api/bots/${selectedBotId}/channels/${selectedChannelId}/permissions`
    )
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          if (data.success && data.permission) {
            setPermissionCheck(data.permission);
          } else {
            setPermissionCheck({
              status: "UNKNOWN",
              message: data.error || "Permission status unknown.",
              canPost: false,
            });
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          setPermissionCheck({
            status: "UNKNOWN",
            message: err.message || "Failed to check permission.",
            canPost: false,
          });
        }
      })
      .finally(() => {
        if (isMounted) setCheckingPermission(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedBotId, selectedChannelId]);

  // Composer Form state
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [postType, setPostType] = useState<"TEXT" | "IMAGE" | "VIDEO" | "ALBUM">("TEXT");
  const [content, setContent] = useState("");
  const [buttons, setButtons] = useState<InlineUrlButton[]>([]);
  const [disableNotification, setDisableNotification] = useState(false);
  const [hasSpoiler, setHasSpoiler] = useState(false);
  const [sendAsDocument, setSendAsDocument] = useState(false);

  // Album items state (for ALBUM postType: 2 to 10 items)
  const [albumItems, setAlbumItems] = useState<AlbumItemDTO[]>([]);
  const [uploadingAlbum, setUploadingAlbum] = useState(false);
  const [albumUploadError, setAlbumUploadError] = useState<string | null>(null);
  const [retryingButtonsPostId, setRetryingButtonsPostId] = useState<string | null>(null);

  // Load sendAsDocument preference from localStorage on mount
  useEffect(() => {
    try {
      const savedPref = localStorage.getItem("botdesk_pref_send_as_document");
      if (savedPref === "true") {
        setSendAsDocument(true);
      }
    } catch {
      // Ignore localStorage access issues
    }
  }, []);

  const handleToggleSendAsDocument = (val: boolean) => {
    setSendAsDocument(val);
    if (val) {
      // Telegram does not support media spoiler animations when sending files as documents
      setHasSpoiler(false);
    }
    try {
      localStorage.setItem("botdesk_pref_send_as_document", val ? "true" : "false");
    } catch {
      // Ignore localStorage access issues
    }
  };

  // Media upload state
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [mediaOriginalName, setMediaOriginalName] = useState<string | null>(null);
  const [mediaMimeType, setMediaMimeType] = useState<string | null>(null);
  const [mediaSizeBytes, setMediaSizeBytes] = useState<number | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Clipboard & Drag-Drop states
  const [canUseClipboardRead, setCanUseClipboardRead] = useState(false);
  const [pastingMedia, setPastingMedia] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<{
    file: File;
    mediaType: "IMAGE" | "VIDEO";
  } | null>(null);

  // Synchronized refs so global listeners always see latest values
  const postTypeRef = useRef(postType);
  postTypeRef.current = postType;
  const mediaPathRef = useRef(mediaPath);
  mediaPathRef.current = mediaPath;
  const albumItemsRef = useRef(albumItems);
  albumItemsRef.current = albumItems;

  // Detect navigator.clipboard.read support on client mount
  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.read === "function"
    ) {
      setCanUseClipboardRead(true);
    }
  }, []);

  // Inline Button Form Modal state
  const [showButtonModal, setShowButtonModal] = useState(false);
  const [btnLabel, setBtnLabel] = useState("");
  const [btnUrl, setBtnUrl] = useState("");
  const [btnError, setBtnError] = useState<string | null>(null);

  // Status & Posts List
  const [posts, setPosts] = useState<PostItemDTO[]>(initialPosts);
  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "warning";
    text: string;
  } | null>(null);

  // Scheduling state
  const [publishMode, setPublishMode] = useState<"NOW" | "SCHEDULE">("NOW");
  const [scheduledDate, setScheduledDate] = useState<string>("");
  const [scheduledTime, setScheduledTime] = useState<string>("");
  const [scheduledTimezone, setScheduledTimezone] = useState<string>(() => {
    try {
      const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (userTz) return userTz;
    } catch {}
    return "Asia/Bangkok";
  });
  const [cancellingPostId, setCancellingPostId] = useState<string | null>(null);
  const [postFilter, setPostFilter] = useState<"ALL" | "SCHEDULED" | "DRAFT" | "PUBLISHED">("ALL");

  // Publish Confirmation Modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [postToPublish, setPostToPublish] = useState<PostItemDTO | null>(null);

  // Reset composer to fresh new post
  const handleResetComposer = () => {
    setEditingPostId(null);
    setPostType("TEXT");
    setContent("");
    setButtons([]);
    setDisableNotification(false);
    setHasSpoiler(false);
    try {
      setSendAsDocument(localStorage.getItem("botdesk_pref_send_as_document") === "true");
    } catch {
      setSendAsDocument(false);
    }
    setMediaPath(null);
    setMediaOriginalName(null);
    setMediaMimeType(null);
    setMediaSizeBytes(null);
    setAlbumItems([]);
    setUploadError(null);
    setAlbumUploadError(null);
    setPendingReplace(null);
    setIsDragOver(false);
    setPastingMedia(false);
    setPublishMode("NOW");
    setScheduledDate("");
    setScheduledTime("");
    setStatusMessage(null);
  };

  // Load existing draft into composer for editing
  const handleEditDraft = (post: PostItemDTO) => {
    setEditingPostId(post.id);
    setPostType(post.postType);
    setContent(post.content || "");
    setButtons(post.buttonsConfig || []);
    setDisableNotification(Boolean(post.disableNotification));
    setHasSpoiler(Boolean(post.hasSpoiler));
    setSendAsDocument(Boolean(post.sendAsDocument));
    setMediaPath(post.mediaPath || null);
    setMediaOriginalName(post.mediaOriginalName || null);
    setMediaMimeType(post.mediaMimeType || null);
    setMediaSizeBytes(post.mediaSizeBytes || null);
    setAlbumItems(post.albumItems ? [...post.albumItems].sort((a, b) => a.order - b.order) : []);
    setUploadError(null);
    setAlbumUploadError(null);
    setPendingReplace(null);
    setIsDragOver(false);
    setPastingMedia(false);
    setSelectedBotId(post.botId);
    setSelectedChannelId(post.channelId);

    if (post.status === "SCHEDULED" && post.scheduledAt) {
      setPublishMode("SCHEDULE");
      const tz = post.scheduledTimezone || scheduledTimezone || "Asia/Bangkok";
      setScheduledTimezone(tz);
      const parts = getDateAndTimeInZone(new Date(post.scheduledAt), tz);
      setScheduledDate(parts.date);
      setScheduledTime(parts.time);
    } else {
      setPublishMode("NOW");
      setScheduledDate("");
      setScheduledTime("");
    }

    setStatusMessage({
      type: "warning",
      text:
        post.status === "SCHEDULED"
          ? `Editing scheduled post (${post.id.slice(0, 8)}). Reschedule or save changes when done.`
          : `Editing draft post (${post.id.slice(0, 8)}). Save changes when done.`,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Cancel a scheduled post and return it to draft
  const handleCancelSchedule = async (postId: string) => {
    if (
      !confirm(
        "Are you sure you want to cancel this scheduled post? It will revert back to Draft status."
      )
    ) {
      return;
    }

    setCancellingPostId(postId);
    try {
      const res = await fetch(`/api/posts/${postId}/cancel-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to cancel scheduled post.");
      }

      setStatusMessage({
        type: "success",
        text: "✓ Scheduled post has been cancelled and returned to Draft status.",
      });

      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                status: "DRAFT",
                scheduledAt: null,
                scheduledTimezone: null,
                lastError: null,
              }
            : p
        )
      );

      if (editingPostId === postId) {
        setPublishMode("NOW");
        setScheduledDate("");
        setScheduledTime("");
      }

      router.refresh();
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to cancel schedule.",
      });
    } finally {
      setCancellingPostId(null);
    }
  };

  // Helper: Upload a single Photo or Video file to server
  const uploadSingleMedia = async (
    file: File,
    explicitType?: "IMAGE" | "VIDEO"
  ): Promise<boolean> => {
    setUploadError(null);
    const targetType =
      explicitType ||
      (file.type.startsWith("video/") || postTypeRef.current === "VIDEO"
        ? "VIDEO"
        : "IMAGE");
    const isVideo = targetType === "VIDEO";
    const allowedImageMimes = ["image/jpeg", "image/png", "image/webp"];
    const allowedVideoMimes = ["video/mp4", "video/webm", "video/quicktime"];

    if (isVideo) {
      if (!allowedVideoMimes.includes(file.type.toLowerCase())) {
        setUploadError("Only MP4, WebM, and QuickTime (MOV) videos are supported.");
        return false;
      }
      if (file.size > 25 * 1024 * 1024) {
        setUploadError("Video size exceeds maximum limit of 25 MB.");
        return false;
      }
    } else {
      if (!allowedImageMimes.includes(file.type.toLowerCase())) {
        setUploadError("Only JPEG, PNG, and WebP images are supported.");
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        setUploadError("Image size exceeds maximum limit of 10 MB.");
        return false;
      }
    }

    setUploadingImage(true);
    const formData = new FormData();
    formData.append("file", file);
    if (selectedBotId) formData.append("botId", selectedBotId);

    try {
      const { ok, data, error } = await safeFetchJson<{
        filename: string;
        originalName?: string | null;
        mimeType?: string | null;
        sizeBytes?: number | null;
      }>("/api/posts/upload", {
        method: "POST",
        body: formData,
      });

      if (!ok || !data) {
        throw new Error(error || "File upload failed");
      }

      setMediaPath(data.filename);
      setMediaOriginalName(data.originalName || null);
      setMediaMimeType(data.mimeType || null);
      setMediaSizeBytes(data.sizeBytes || null);

      // Auto-switch postType if currently in TEXT mode
      if (isVideo && postTypeRef.current !== "VIDEO") {
        setPostType("VIDEO");
      } else if (!isVideo && postTypeRef.current !== "IMAGE" && postTypeRef.current !== "ALBUM") {
        setPostType("IMAGE");
      }

      setStatusMessage({
        type: "success",
        text: `✓ ${isVideo ? "Video" : "Photo"} loaded (${data.originalName}). Telegram preview updated.`,
      });
      return true;
    } catch (err: any) {
      setUploadError(err.message || "Failed to upload file.");
      return false;
    } finally {
      setUploadingImage(false);
    }
  };

  // Helper: Upload media items to append to album
  const uploadAlbumMedia = async (files: File[]): Promise<boolean> => {
    setAlbumUploadError(null);
    if (files.length === 0) return false;

    const currentCount = albumItemsRef.current.length;
    if (currentCount >= 10) {
      setAlbumUploadError(
        "Album already contains the maximum of 10 items. Remove an item before adding more."
      );
      return false;
    }

    if (currentCount + files.length > 10) {
      setAlbumUploadError(
        `Cannot add ${files.length} item(s): album would exceed maximum of 10 items (currently has ${currentCount}).`
      );
      return false;
    }

    const allowedImageMimes = ["image/jpeg", "image/png", "image/webp"];
    const allowedVideoMimes = ["video/mp4", "video/webm", "video/quicktime"];

    for (const f of files) {
      const type = f.type.toLowerCase();
      const isImg = allowedImageMimes.includes(type);
      const isVid = allowedVideoMimes.includes(type);

      if (!isImg && !isVid) {
        setAlbumUploadError(
          `Unsupported file type for "${f.name}". Supported formats: JPEG, PNG, WebP, MP4, WebM, QuickTime MOV.`
        );
        return false;
      }

      if (isImg && f.size > 10 * 1024 * 1024) {
        setAlbumUploadError(`Photo "${f.name}" exceeds maximum limit of 10 MB.`);
        return false;
      }

      if (isVid && f.size > 25 * 1024 * 1024) {
        setAlbumUploadError(`Video "${f.name}" exceeds maximum limit of 25 MB.`);
        return false;
      }
    }

    setUploadingAlbum(true);
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    if (selectedBotId) formData.append("botId", selectedBotId);

    try {
      const { ok, data, error } = await safeFetchJson<{
        items?: any[];
      }>("/api/posts/upload", {
        method: "POST",
        body: formData,
      });

      if (!ok || !data) {
        throw new Error(error || "Album files upload failed.");
      }

      const uploadedList: AlbumItemDTO[] = (data.items || []).map(
        (it: any, idx: number) => ({
          mediaType: it.mediaType as "IMAGE" | "VIDEO",
          filePath: it.filePath || it.filename,
          originalName: it.originalName,
          mimeType: it.mimeType,
          sizeBytes: it.sizeBytes,
          order: currentCount + idx,
          hasSpoiler: false,
        })
      );

      setAlbumItems((prev) => [...prev, ...uploadedList]);
      setStatusMessage({
        type: "success",
        text: `✓ Added ${uploadedList.length} item(s) to album. Total slides: ${currentCount + uploadedList.length}.`,
      });
      return true;
    } catch (err: any) {
      setAlbumUploadError(err.message || "Failed to upload album files.");
      return false;
    } finally {
      setUploadingAlbum(false);
    }
  };

  // Central processor for pasted or dropped media files
  const handlePastedMediaFiles = async (rawFiles: File[]) => {
    if (rawFiles.length === 0) return;

    // Normalize filenames with timestamps and appropriate extensions
    const normalizedFiles = rawFiles.map((file, idx) => {
      let name = file.name || "";
      const hasExt = name.includes(".") && name.lastIndexOf(".") > 0;
      if (!name || name === "blob" || name === "image" || name === "media.bin" || !hasExt) {
        const mime = (file.type || "").toLowerCase();
        const ext =
          mime === "image/jpeg" ? ".jpg"
          : mime === "image/webp" ? ".webp"
          : mime === "video/mp4" ? ".mp4"
          : mime === "video/webm" ? ".webm"
          : mime === "video/quicktime" ? ".mov"
          : ".png";
        const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
        name = `pasted_media_${dateStr}_${idx + 1}${ext}`;
      }
      return new File([file], name, { type: file.type });
    });

    const currentType = postTypeRef.current;

    // Album mode: append files (one at a time or in batch)
    if (currentType === "ALBUM") {
      await uploadAlbumMedia(normalizedFiles);
      return;
    }

    // Single media mode (IMAGE, VIDEO, or TEXT)
    const firstFile = normalizedFiles[0];
    const isVideo = firstFile.type.startsWith("video/");
    const targetMode = isVideo ? "VIDEO" : "IMAGE";

    if (currentType === "TEXT") {
      // Auto-switch to IMAGE or VIDEO and retain caption
      await uploadSingleMedia(firstFile, targetMode);
    } else if (currentType === "IMAGE") {
      if (isVideo) {
        setStatusMessage({
          type: "warning",
          text: "You pasted a video while in Photo mode. Switch to Video or Album mode to attach it.",
        });
        return;
      }
      if (mediaPathRef.current) {
        // Safe replacement prompt: do not overwrite silently!
        setPendingReplace({ file: firstFile, mediaType: "IMAGE" });
      } else {
        await uploadSingleMedia(firstFile, "IMAGE");
      }
    } else if (currentType === "VIDEO") {
      if (!isVideo) {
        setStatusMessage({
          type: "warning",
          text: "You pasted a photo while in Video mode. Switch to Photo or Album mode to attach it.",
        });
        return;
      }
      if (mediaPathRef.current) {
        // Safe replacement prompt: do not overwrite silently!
        setPendingReplace({ file: firstFile, mediaType: "VIDEO" });
      } else {
        await uploadSingleMedia(firstFile, "VIDEO");
      }
    }
  };

  // Confirm replacement of existing media from modal
  const handleConfirmReplace = async () => {
    if (!pendingReplace) return;
    const { file, mediaType } = pendingReplace;
    setPendingReplace(null);
    await uploadSingleMedia(file, mediaType);
  };

  // Explicit Clipboard Read button click
  const handleClipboardButtonClick = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setStatusMessage({
        type: "warning",
        text: "Clipboard API is not available in this browser. You can still paste directly using Ctrl+V or use the file picker.",
      });
      return;
    }

    try {
      setPastingMedia(true);
      setStatusMessage(null);

      if (typeof navigator.clipboard.read === "function") {
        const items = await navigator.clipboard.read();
        const extracted: File[] = [];

        for (const item of items) {
          // Check for image types
          for (const type of ["image/png", "image/jpeg", "image/webp"]) {
            if (item.types.includes(type)) {
              const blob = await item.getType(type);
              const ext =
                type === "image/jpeg" ? ".jpg"
                : type === "image/webp" ? ".webp"
                : ".png";
              const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
              extracted.push(
                new File([blob], `pasted_clipboard_${dateStr}${ext}`, { type })
              );
              break;
            }
          }
          // Check for video types if supplied
          for (const type of ["video/mp4", "video/webm", "video/quicktime"]) {
            if (item.types.includes(type)) {
              const blob = await item.getType(type);
              const ext =
                type === "video/webm" ? ".webm"
                : type === "video/quicktime" ? ".mov"
                : ".mp4";
              const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
              extracted.push(
                new File([blob], `pasted_video_${dateStr}${ext}`, { type })
              );
              break;
            }
          }
        }

        if (extracted.length > 0) {
          await handlePastedMediaFiles(extracted);
          return;
        }
      }

      // Check readText fallback
      if (typeof navigator.clipboard.readText === "function") {
        const text = await navigator.clipboard.readText().catch(() => "");
        if (text) {
          const isPath =
            text.includes(":\\") ||
            text.includes(":/") ||
            (text.startsWith("/") && !text.startsWith("//")) ||
            /\.(jpg|jpeg|png|webp|mp4|webm|mov)$/i.test(text);
          const isUrl = /^https?:\/\//i.test(text);

          if (isPath || isUrl) {
            setStatusMessage({
              type: "warning",
              text: `⚠️ Clipboard contains a ${isUrl ? "URL" : "file path"} ("${text.slice(0, 60)}..."), not actual file bytes. Web browsers cannot access local files from paths. Please use the file picker or drag & drop the actual file.`,
            });
            return;
          }
        }
      }

      setStatusMessage({
        type: "warning",
        text: "ℹ️ No image or video found in your clipboard. Take a screenshot (Win+Shift+S on Windows) or copy an image file first, then click paste.",
      });
    } catch (err: any) {
      if (err.name === "NotAllowedError" || err.message?.includes("denied")) {
        setStatusMessage({
          type: "warning",
          text: "⚠️ Clipboard permission was denied by your browser. You can still paste directly using Ctrl+V or use the file picker.",
        });
      } else {
        setStatusMessage({
          type: "error",
          text: err.message || "Failed to read clipboard.",
        });
      }
    } finally {
      setPastingMedia(false);
    }
  };

  // Global paste event listener
  useEffect(() => {
    const onGlobalPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;

      // 1. Do not intercept if user is in any text input or contentEditable
      if (
        target instanceof HTMLInputElement ||
        target?.closest('input[type="text"], input[type="url"], input[type="password"], input[type="email"]') ||
        target?.isContentEditable
      ) {
        return;
      }

      // 2. If user is in textarea, allow normal text paste if text is present
      if (target instanceof HTMLTextAreaElement) {
        const plainText = e.clipboardData?.getData("text/plain");
        if (plainText && plainText.length > 0) {
          return;
        }
      }

      // 3. Extract media files from clipboard
      const files: File[] = [];
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        files.push(...Array.from(e.clipboardData.files));
      } else if (e.clipboardData?.items) {
        for (let i = 0; i < e.clipboardData.items.length; i++) {
          const item = e.clipboardData.items[i];
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
      }

      if (files.length > 0) {
        e.preventDefault();
        handlePastedMediaFiles(files);
        return;
      }

      // 4. If no files, check for path or URL fallback when not in textarea
      if (!(target instanceof HTMLTextAreaElement)) {
        const plainText = e.clipboardData?.getData("text/plain")?.trim();
        if (plainText) {
          const isPath =
            plainText.includes(":\\") ||
            plainText.includes(":/") ||
            (plainText.startsWith("/") && !plainText.startsWith("//")) ||
            /\.(jpg|jpeg|png|webp|mp4|webm|mov)$/i.test(plainText);
          const isUrl = /^https?:\/\//i.test(plainText);

          if (isPath || isUrl) {
            e.preventDefault();
            setStatusMessage({
              type: "warning",
              text: `⚠️ Clipboard contains a ${isUrl ? "URL" : "file path"} ("${plainText.slice(0, 60)}..."), not the media file itself. Web browsers cannot access local files from paths. Please use the file picker or drag & drop the actual file.`,
            });
          }
        }
      }
    };

    window.addEventListener("paste", onGlobalPaste);
    return () => {
      window.removeEventListener("paste", onGlobalPaste);
    };
  }, []);

  // Handle single media file selection via file picker
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (mediaPathRef.current) {
      setPendingReplace({
        file,
        mediaType: postTypeRef.current === "VIDEO" ? "VIDEO" : "IMAGE",
      });
    } else {
      await uploadSingleMedia(file);
    }
    e.target.value = "";
  };

  // Handle multi-file album selection via file picker
  const handleAlbumFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    await uploadAlbumMedia(files);
    e.target.value = "";
  };

  const handleRemoveAlbumItem = (index: number) => {
    setAlbumItems((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((item, i) => ({ ...item, order: i }))
    );
  };

  const handleMoveAlbumItem = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= albumItems.length) return;

    setAlbumItems((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy.map((item, i) => ({ ...item, order: i }));
    });
  };

  const handleToggleAlbumItemSpoiler = (index: number) => {
    setAlbumItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, hasSpoiler: !item.hasSpoiler } : item
      )
    );
  };

  const handleRetryButtons = async (postId: string) => {
    setRetryingButtonsPostId(postId);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/posts/${postId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RETRY_BUTTONS" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to deliver follow-up buttons.");
      }
      setStatusMessage({
        type: "success",
        text: `🎉 Follow-up inline buttons successfully delivered! Button Message ID: #${data.buttonMessageId}`,
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                status: "PUBLISHED",
                buttonMessageId: data.buttonMessageId,
                lastError: null,
              }
            : p
        )
      );
      router.refresh();
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to deliver buttons.",
      });
    } finally {
      setRetryingButtonsPostId(null);
    }
  };

  // Handle adding inline button
  const handleAddButton = (e: React.FormEvent) => {
    e.preventDefault();
    setBtnError(null);

    const label = btnLabel.trim();
    if (!label) {
      setBtnError("Button label is required.");
      return;
    }
    if (label.length > 64) {
      setBtnError("Button label cannot exceed 64 characters.");
      return;
    }

    const url = btnUrl.trim();
    if (!url) {
      setBtnError("Destination URL is required.");
      return;
    }

    const lower = url.toLowerCase();
    const isAllowedScheme =
      lower.startsWith("https://") ||
      lower.startsWith("http://127.0.0.1") ||
      lower.startsWith("http://localhost") ||
      lower.startsWith("tg://");

    if (!isAllowedScheme) {
      setBtnError("URL must be a secure HTTPS link or Telegram link (tg://).");
      return;
    }

    if (buttons.length >= 10) {
      setBtnError("Maximum limit of 10 inline buttons reached.");
      return;
    }

    setButtons([
      ...buttons,
      { label, url, order: buttons.length },
    ]);
    setBtnLabel("");
    setBtnUrl("");
    setShowButtonModal(false);
  };

  const handleRemoveButton = (index: number) => {
    setButtons(buttons.filter((_, i) => i !== index).map((b, i) => ({ ...b, order: i })));
  };

  // Save Draft (Create or Update)
  const handleSaveDraft = async () => {
    if (!selectedBotId || !selectedChannelId) {
      setStatusMessage({
        type: "error",
        text: "Please select both a Bot and a Target Channel.",
      });
      return;
    }

    if (postType === "TEXT" && !content.trim()) {
      setStatusMessage({
        type: "error",
        text: "Text post requires non-empty message content.",
      });
      return;
    }

    if (postType === "IMAGE" && !mediaPath) {
      setStatusMessage({
        type: "error",
        text: "Image post requires an uploaded photo.",
      });
      return;
    }

    if (postType === "VIDEO" && !mediaPath) {
      setStatusMessage({
        type: "error",
        text: "Video post requires an uploaded video file.",
      });
      return;
    }

    if (postType === "ALBUM") {
      if (albumItems.length < 2) {
        setStatusMessage({
          type: "error",
          text: "Media album requires at least 2 photos or videos (maximum 10).",
        });
        return;
      }
      if (albumItems.length > 10) {
        setStatusMessage({
          type: "error",
          text: "Media album cannot exceed 10 photos or videos.",
        });
        return;
      }
    }

    if (hasSpoiler && sendAsDocument) {
      setStatusMessage({
        type: "error",
        text: "Telegram does not support media spoiler when sending files as documents.",
      });
      return;
    }

    setSavingDraft(true);
    setStatusMessage(null);

    try {
      const payload = {
        botId: selectedBotId,
        channelId: selectedChannelId,
        postType,
        content,
        mediaPath,
        mediaOriginalName,
        mediaMimeType,
        mediaSizeBytes,
        albumItems: postType === "ALBUM" ? albumItems : undefined,
        buttons,
        disableNotification,
        hasSpoiler,
        sendAsDocument,
      };

      const url = editingPostId
        ? `/api/posts/${editingPostId}`
        : `/api/bots/${selectedBotId}/channels/${selectedChannelId}/posts`;
      const method = editingPostId ? "PUT" : "POST";

      const { ok, data, error } = await safeFetchJson<{ post: any }>(url, {
        method,
        body: payload,
      });

      if (!ok || !data) {
        throw new Error(error || "Failed to save draft post.");
      }

      setStatusMessage({
        type: "success",
        text: editingPostId
          ? "Draft post updated successfully in PostgreSQL!"
          : "Draft post created and saved to PostgreSQL!",
      });

      // Refresh post list
      if (editingPostId) {
        setPosts((prev) =>
          prev.map((p) => (p.id === editingPostId ? { ...p, ...data.post } : p))
        );
      } else {
        setPosts((prev) => [data.post, ...prev]);
        setEditingPostId(data.post.id);
      }

      router.refresh();
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to save draft.",
      });
    } finally {
      setSavingDraft(false);
    }
  };

  // Open Publish / Schedule Confirmation Modal
  const handleOpenPublish = (post?: PostItemDTO) => {
    if (post) {
      setPostToPublish(post);
    } else {
      // Create temporary representation from composer
      if (postType === "TEXT" && !content.trim()) {
        setStatusMessage({
          type: "error",
          text: "Please enter text content before publishing.",
        });
        return;
      }
      if (postType === "IMAGE" && !mediaPath) {
        setStatusMessage({
          type: "error",
          text: "Please upload an image before publishing.",
        });
        return;
      }
      if (postType === "VIDEO" && !mediaPath) {
        setStatusMessage({
          type: "error",
          text: "Please upload a video before publishing.",
        });
        return;
      }
      if (postType === "ALBUM" && (albumItems.length < 2 || albumItems.length > 10)) {
        setStatusMessage({
          type: "error",
          text: "Please upload between 2 and 10 photos or videos before publishing an album.",
        });
        return;
      }

      let parsedUtcIso: string | null = null;
      if (publishMode === "SCHEDULE") {
        if (!scheduledDate || !scheduledTime || !scheduledTimezone) {
          setStatusMessage({
            type: "error",
            text: "Please provide a scheduled date, time, and timezone before scheduling.",
          });
          return;
        }
        try {
          const parsed = validateAndParseZonedDateTime(
            scheduledDate,
            scheduledTime,
            scheduledTimezone
          );
          validateFutureSchedule(parsed.utcDate);
          parsedUtcIso = parsed.utcDate.toISOString();
        } catch (err: any) {
          setStatusMessage({
            type: "error",
            text: err.message || "Invalid schedule date or time.",
          });
          return;
        }
      }

      setPostToPublish({
        id: editingPostId || "new",
        botId: selectedBotId,
        channelId: selectedChannelId,
        channelName: activeChannel?.name,
        channelChatId: activeChannel?.telegramChatId,
        postType,
        content,
        mediaPath,
        mediaOriginalName,
        mediaMimeType,
        mediaSizeBytes,
        albumItems: postType === "ALBUM" ? albumItems : undefined,
        buttonsConfig: buttons,
        disableNotification,
        hasSpoiler,
        sendAsDocument,
        status: publishMode === "SCHEDULE" ? "SCHEDULED" : "DRAFT",
        scheduledAt: parsedUtcIso,
        scheduledTimezone: publishMode === "SCHEDULE" ? scheduledTimezone : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    setShowConfirmModal(true);
  };

  // Execute Publish or Schedule to Telegram
  const handleConfirmPublish = async () => {
    if (!postToPublish) return;

    setPublishing(true);
    setStatusMessage(null);

    try {
      let targetPostId = postToPublish.id;

      // Check if we are scheduling from the composer
      if (publishMode === "SCHEDULE" && postToPublish.status === "SCHEDULED") {
        const schedulePayload = {
          botId: selectedBotId,
          channelId: selectedChannelId,
          postType,
          content,
          mediaPath,
          mediaOriginalName,
          mediaMimeType,
          mediaSizeBytes,
          albumItems: postType === "ALBUM" ? albumItems : undefined,
          buttons,
          disableNotification,
          hasSpoiler,
          sendAsDocument,
          status: "SCHEDULED",
          scheduledDate,
          scheduledTime,
          scheduledTimezone,
        };

        const schedUrl = targetPostId === "new"
          ? `/api/bots/${selectedBotId}/channels/${selectedChannelId}/posts`
          : `/api/posts/${targetPostId}`;
        const schedMethod = targetPostId === "new" ? "POST" : "PUT";

        const { ok, data, error } = await safeFetchJson<{ post: any }>(schedUrl, {
          method: schedMethod,
          body: schedulePayload,
        });

        if (!ok || !data) {
          throw new Error(error || "Failed to schedule post.");
        }

        setStatusMessage({
          type: "success",
          text: `🎉 Post successfully scheduled for ${formatScheduledDisplay(
            data.post.scheduledAt,
            data.post.scheduledTimezone
          )}! The BackStage scheduler worker will broadcast it automatically.`,
        });

        if (targetPostId === "new") {
          setPosts((prev) => [data.post, ...prev]);
        } else {
          setPosts((prev) =>
            prev.map((p) => (p.id === targetPostId ? { ...p, ...data.post } : p))
          );
        }

        handleResetComposer();
        setShowConfirmModal(false);
        router.refresh();
        return;
      }

      // If publishing immediately from composer without saving first, save draft first
      if (targetPostId === "new") {
        const { ok: createOk, data: createData, error: createError } = await safeFetchJson<{ post: any }>(
          `/api/bots/${selectedBotId}/channels/${selectedChannelId}/posts`,
          {
            method: "POST",
            body: {
              postType,
              content,
              mediaPath,
              mediaOriginalName,
              mediaMimeType,
              mediaSizeBytes,
              albumItems: postType === "ALBUM" ? albumItems : undefined,
              buttons,
              disableNotification,
              hasSpoiler,
              sendAsDocument,
            },
          }
        );
        if (!createOk || !createData) {
          throw new Error(createError || "Failed to initialize post draft before sending.");
        }
        targetPostId = createData.post.id;
        setPosts((prev) => [createData.post, ...prev]);
        setEditingPostId(targetPostId);
      }

      // Call publish API endpoint
      const { ok, data, error } = await safeFetchJson<{
        status?: string;
        error?: string;
        messageId?: number;
        albumMessageIds?: number[];
        buttonMessageId?: number;
      }>(`/api/posts/${targetPostId}/publish`, {
        method: "POST",
      });

      if (!ok) {
        // Handle UNKNOWN vs PARTIAL vs definitive FAILED
        if (data?.status === "UNKNOWN") {
          setStatusMessage({
            type: "warning",
            text: `⚠️ Network Timeout: ${error || data?.error}. Do not re-publish blindly. Please check your Telegram channel to see if it arrived.`,
          });
          setPosts((prev) =>
            prev.map((p) =>
              p.id === targetPostId
                ? { ...p, status: "UNKNOWN", lastError: error || data?.error }
                : p
            )
          );
        } else if (data?.status === "PARTIAL") {
          setStatusMessage({
            type: "warning",
            text: `⚠️ Album media published successfully (Telegram Message IDs: [${data?.albumMessageIds?.join(", ")}]), but follow-up inline buttons failed: ${error || data?.error}. You can click "Retry Buttons" in Post History to deliver them without re-sending the album.`,
          });
          setPosts((prev) =>
            prev.map((p) =>
              p.id === targetPostId
                ? {
                    ...p,
                    status: "PARTIAL",
                    telegramMessageId: data?.messageId,
                    albumMessageIds: data?.albumMessageIds || null,
                    lastError: error || data?.error,
                  }
                : p
            )
          );
          handleResetComposer();
        } else {
          throw new Error(error || data?.error || "Failed to publish post to channel.");
        }
      } else {
        const isAlbum = postToPublish.postType === "ALBUM";
        const buttonInfo = data?.buttonMessageId
          ? ` with Follow-up Buttons (#${data?.buttonMessageId})`
          : "";
        const msgInfo =
          isAlbum && data?.albumMessageIds?.length
            ? `Album Message IDs: [${data.albumMessageIds.join(", ")}]${buttonInfo}`
            : `Telegram Message ID: ${data?.messageId}`;

        setStatusMessage({
          type: "success",
          text: `🎉 Successfully published to ${activeChannel?.name || "channel"}! ${msgInfo}`,
        });

        setPosts((prev) =>
          prev.map((p) =>
            p.id === targetPostId
              ? {
                  ...p,
                  status: "PUBLISHED",
                  telegramMessageId: data?.messageId,
                  albumMessageIds: data?.albumMessageIds || null,
                  buttonMessageId: data?.buttonMessageId || null,
                  sentAt: new Date().toISOString(),
                  lastError: null,
                }
              : p
          )
        );

        handleResetComposer();
      }

      setShowConfirmModal(false);
      router.refresh();
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to publish post.",
      });
      setShowConfirmModal(false);
    } finally {
      setPublishing(false);
    }
  };

  // Delete post handler
  const handleDeletePost = async (id: string) => {
    if (!confirm("Are you sure you want to delete this draft?")) return;

    try {
      const { ok, error } = await safeFetchJson(`/api/posts/${id}`, { method: "DELETE" });
      if (!ok) {
        throw new Error(error || "Failed to delete post");
      }

      setPosts((prev) => prev.filter((p) => p.id !== id));
      if (editingPostId === id) {
        handleResetComposer();
      }
      setStatusMessage({
        type: "success",
        text: "Post deleted successfully.",
      });
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: err.message || "Error deleting post.",
      });
    }
  };

  const currentChars = content.length;
  const maxChars = postType === "TEXT" ? 4096 : 1024;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <span className="botdesk-badge blue text-[10px] tracking-wider uppercase mb-1 inline-block">
          Channel Publishing
        </span>
        <h1 className="text-xl font-bold text-[var(--text)]">
          Channel Posts & Broadcast
        </h1>
        <p className="text-xs text-[var(--muted)] mt-1">
          Prepare, preview, draft, and publish posts to Telegram channels managed by your bots.
        </p>
      </div>

      {/* Target Selector & Bot Permission Bar */}
      <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
              Select Publishing Bot
            </label>
            <select
              value={selectedBotId}
              onChange={(e) => setSelectedBotId(e.target.value)}
              className="botdesk-select text-xs w-full"
            >
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} (@{b.username})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
              Select Target Channel
            </label>
            <select
              value={selectedChannelId}
              onChange={(e) => setSelectedChannelId(e.target.value)}
              className="botdesk-select text-xs w-full"
              disabled={channels.length === 0}
            >
              {channels.length === 0 ? (
                <option value="">No channels configured for this bot</option>
              ) : (
                channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.telegramChatId})
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Known Connection / Permission State */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-[var(--border)] text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[var(--muted)]">Bot Channel Permission:</span>
            {checkingPermission ? (
              <span className="botdesk-badge text-[11px] paused">
                Verifying Telegram API...
              </span>
            ) : permissionCheck ? (
              <span
                className={`botdesk-badge text-[11px] ${
                  permissionCheck.status === "CAN_POST"
                    ? "enabled"
                    : permissionCheck.status === "CANNOT_POST"
                    ? "paused"
                    : permissionCheck.status === "NOT_ADMIN"
                    ? "red"
                    : "paused"
                }`}
              >
                {permissionCheck.status === "CAN_POST"
                  ? "✓ Can Post Messages"
                  : permissionCheck.status === "CANNOT_POST"
                  ? "⚠️ Missing Post Permission"
                  : permissionCheck.status === "NOT_ADMIN"
                  ? "✕ Not Channel Admin"
                  : "? Permission Unknown"}
              </span>
            ) : (
              <span className="botdesk-badge text-[11px] paused">
                Select a channel
              </span>
            )}
          </div>

          {permissionCheck && (
            <span className="text-[11px] text-[var(--muted)] italic">
              {permissionCheck.message}
            </span>
          )}
        </div>
      </div>

      {/* Status Banner */}
      {statusMessage && (
        <div
          className={`p-3 rounded-lg text-xs border ${
            statusMessage.type === "success"
              ? "bg-[var(--greenbg)] border-[var(--green)] text-[var(--green)]"
              : statusMessage.type === "warning"
              ? "bg-[var(--surface)] border-[var(--accent)] text-[var(--accent)]"
              : "bg-[var(--redbg)] border-[var(--red)] text-[var(--red)]"
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Two-Column Layout: Composer (Left) & Telegram Preview (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Compose Area */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--text)]">
                  {editingPostId ? "Edit Post Draft" : "Compose Channel Post"}
                </h2>
                <p className="text-[11px] text-[var(--muted)]">
                  {postType === "TEXT"
                    ? "Compose text message with optional inline buttons"
                    : postType === "IMAGE"
                    ? "Upload one photo with caption and optional inline buttons"
                    : "Upload one video with caption, delivery options, and optional inline buttons"}
                </p>
              </div>

              {editingPostId && (
                <button
                  type="button"
                  onClick={handleResetComposer}
                  className="botdesk-btn text-xs py-1 px-2.5"
                >
                  ＋ New Post
                </button>
              )}
            </div>

            {/* Post Type Selector */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
                Post Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setPostType("TEXT")}
                  className={`botdesk-btn text-xs py-2 ${
                    postType === "TEXT"
                      ? "bg-[var(--bluebg)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                      : ""
                  }`}
                >
                  📝 Text-Only
                </button>
                <button
                  type="button"
                  onClick={() => setPostType("IMAGE")}
                  className={`botdesk-btn text-xs py-2 ${
                    postType === "IMAGE"
                      ? "bg-[var(--bluebg)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                      : ""
                  }`}
                >
                  🖼️ Photo
                </button>
                <button
                  type="button"
                  onClick={() => setPostType("VIDEO")}
                  className={`botdesk-btn text-xs py-2 ${
                    postType === "VIDEO"
                      ? "bg-[var(--bluebg)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                      : ""
                  }`}
                >
                  🎥 Video
                </button>
                <button
                  type="button"
                  onClick={() => setPostType("ALBUM")}
                  className={`botdesk-btn text-xs py-2 ${
                    postType === "ALBUM"
                      ? "bg-[var(--bluebg)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                      : ""
                  }`}
                >
                  📸 Album (2–10)
                </button>
              </div>
            </div>

            {/* Image Upload Area (If postType === IMAGE) */}
            {postType === "IMAGE" && (
              <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[var(--text)]">
                    Upload or Paste Photo
                  </label>
                  <span className="text-[11px] text-[var(--muted)]">
                    JPEG, PNG, WebP (Max 10 MB)
                  </span>
                </div>

                {/* Drop & Paste Zone if no image attached */}
                {!mediaPath ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragOver(false);
                      const files = Array.from(e.dataTransfer.files || []);
                      if (files.length > 0) handlePastedMediaFiles(files);
                    }}
                    className={`p-4 rounded-lg border-2 border-dashed transition-all text-center space-y-2.5 ${
                      isDragOver
                        ? "border-[var(--accent)] bg-[var(--bluebg)]"
                        : "border-[var(--border)] hover:border-[var(--accent)]/50 bg-[var(--surface)]"
                    }`}
                  >
                    <div className="flex flex-col items-center justify-center gap-1">
                      <span className="text-2xl">📋</span>
                      <p className="text-xs font-semibold text-[var(--text)]">
                        Paste screenshot (Ctrl+V) or drag & drop photo here
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        Supports clipboard screenshots (Win+Shift+S) & files
                      </p>
                    </div>

                    <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                      {canUseClipboardRead && (
                        <button
                          type="button"
                          disabled={pastingMedia || uploadingImage}
                          onClick={handleClipboardButtonClick}
                          className="botdesk-btn text-xs py-1.5 px-3 flex items-center gap-1.5 font-medium"
                          title="Read image from system clipboard"
                        >
                          <span>📋 Paste from Clipboard</span>
                        </button>
                      )}

                      <label className="botdesk-btn text-xs py-1.5 px-3 cursor-pointer flex items-center gap-1.5 font-medium">
                        <span>📁 Choose File</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handleFileChange}
                          disabled={uploadingImage || pastingMedia}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-[11px] text-[var(--muted)] bg-[var(--surface)] p-2.5 rounded-lg border border-[var(--border)] gap-2 flex-wrap">
                    <div className="flex items-center gap-2 truncate min-w-0">
                      <div className="w-8 h-8 rounded bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center flex-shrink-0 overflow-hidden">
                        <img
                          src={`/api/media/posts/${mediaPath}`}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="truncate font-medium text-[var(--text)]">
                        📷 {mediaOriginalName || mediaPath} (
                        {mediaSizeBytes
                          ? `${(mediaSizeBytes / 1024).toFixed(1)} KB`
                          : "Uploaded"}
                        )
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canUseClipboardRead && (
                        <button
                          type="button"
                          disabled={pastingMedia || uploadingImage}
                          onClick={handleClipboardButtonClick}
                          className="botdesk-btn text-[11px] py-1 px-2"
                          title="Paste new image from clipboard to replace"
                        >
                          📋 Paste New
                        </button>
                      )}
                      <label className="botdesk-btn text-[11px] py-1 px-2 cursor-pointer">
                        <span>📁 Replace</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handleFileChange}
                          disabled={uploadingImage || pastingMedia}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setMediaPath(null);
                          setMediaOriginalName(null);
                          setMediaMimeType(null);
                          setMediaSizeBytes(null);
                        }}
                        className="text-[var(--red)] hover:underline text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}

                {(uploadingImage || pastingMedia) && (
                  <p className="text-[11px] text-[var(--accent)] italic">
                    Processing and uploading image to local storage...
                  </p>
                )}

                {uploadError && (
                  <p className="text-[11px] text-[var(--red)]">{uploadError}</p>
                )}
              </div>
            )}

            {/* Video Upload Area (If postType === VIDEO) */}
            {postType === "VIDEO" && (
              <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[var(--text)]">
                    Upload or Paste Video
                  </label>
                  <span className="text-[11px] text-[var(--muted)]">
                    MP4, WebM, QuickTime MOV (Max 25 MB)
                  </span>
                </div>

                {/* Drop & Paste Zone if no video attached */}
                {!mediaPath ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragOver(false);
                      const files = Array.from(e.dataTransfer.files || []);
                      if (files.length > 0) handlePastedMediaFiles(files);
                    }}
                    className={`p-4 rounded-lg border-2 border-dashed transition-all text-center space-y-2.5 ${
                      isDragOver
                        ? "border-[var(--accent)] bg-[var(--bluebg)]"
                        : "border-[var(--border)] hover:border-[var(--accent)]/50 bg-[var(--surface)]"
                    }`}
                  >
                    <div className="flex flex-col items-center justify-center gap-1">
                      <span className="text-2xl">🎥</span>
                      <p className="text-xs font-semibold text-[var(--text)]">
                        Paste video (Ctrl+V) or drag & drop video file here
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        MP4, WebM, MOV up to 25 MB
                      </p>
                    </div>

                    <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                      {canUseClipboardRead && (
                        <button
                          type="button"
                          disabled={pastingMedia || uploadingImage}
                          onClick={handleClipboardButtonClick}
                          className="botdesk-btn text-xs py-1.5 px-3 flex items-center gap-1.5 font-medium"
                          title="Read video from clipboard if available"
                        >
                          <span>📋 Paste from Clipboard</span>
                        </button>
                      )}

                      <label className="botdesk-btn text-xs py-1.5 px-3 cursor-pointer flex items-center gap-1.5 font-medium">
                        <span>📁 Choose Video File</span>
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime"
                          onChange={handleFileChange}
                          disabled={uploadingImage || pastingMedia}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-[11px] text-[var(--muted)] bg-[var(--surface)] p-2.5 rounded-lg border border-[var(--border)] gap-2 flex-wrap">
                    <div className="flex items-center gap-2 truncate min-w-0">
                      <span className="text-xl">🎥</span>
                      <span className="truncate font-medium text-[var(--text)]">
                        {mediaOriginalName || mediaPath} (
                        {mediaSizeBytes
                          ? `${(mediaSizeBytes / (1024 * 1024)).toFixed(2)} MB`
                          : "Uploaded"}
                        )
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canUseClipboardRead && (
                        <button
                          type="button"
                          disabled={pastingMedia || uploadingImage}
                          onClick={handleClipboardButtonClick}
                          className="botdesk-btn text-[11px] py-1 px-2"
                          title="Paste new video from clipboard to replace"
                        >
                          📋 Paste New
                        </button>
                      )}
                      <label className="botdesk-btn text-[11px] py-1 px-2 cursor-pointer">
                        <span>📁 Replace</span>
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime"
                          onChange={handleFileChange}
                          disabled={uploadingImage || pastingMedia}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setMediaPath(null);
                          setMediaOriginalName(null);
                          setMediaMimeType(null);
                          setMediaSizeBytes(null);
                        }}
                        className="text-[var(--red)] hover:underline text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}

                {(uploadingImage || pastingMedia) && (
                  <p className="text-[11px] text-[var(--accent)] italic">
                    Processing and uploading video to local storage...
                  </p>
                )}

                {uploadError && (
                  <p className="text-[11px] text-[var(--red)]">{uploadError}</p>
                )}

                {/* Send as Document / Normal Video Toggle */}
                <div className="pt-2 border-t border-[var(--border)] space-y-1.5">
                  <label className="block text-[11px] font-semibold text-[var(--text)]">
                    Telegram Video Dispatch Method
                  </label>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleToggleSendAsDocument(false)}
                      className={`botdesk-btn py-1.5 px-2 text-[11px] ${
                        !sendAsDocument
                          ? "bg-[var(--bluebg)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                          : ""
                      }`}
                    >
                      🎬 Regular Video (sendVideo)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleSendAsDocument(true)}
                      className={`botdesk-btn py-1.5 px-2 text-[11px] ${
                        sendAsDocument
                          ? "bg-[var(--bluebg)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                          : ""
                      }`}
                    >
                      📄 Send as File / Document (sendDocument)
                    </button>
                  </div>
                  <p className="text-[10px] text-[var(--muted)]">
                    {sendAsDocument
                      ? "Preserves original uncompressed file. Note: Telegram does not support spoiler blur when sending files as documents."
                      : "Sends as playable video with streaming and optional spoiler blur."}
                  </p>
                  <p className="text-[10px] text-[var(--accent)] italic">
                    ✓ Preference remembered locally in your browser for future video drafts.
                  </p>
                </div>
              </div>
            )}

            {/* Album Upload & Management Area (If postType === ALBUM) */}
            {postType === "ALBUM" && (
              <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[var(--text)]">
                    Upload or Paste Album Media (2–10 Photos & Videos)
                  </label>
                  <span className="text-[11px] text-[var(--muted)]">
                    Photos (Max 10 MB) • Videos (Max 25 MB)
                  </span>
                </div>

                {/* Drop & Paste Zone for Album */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    const files = Array.from(e.dataTransfer.files || []);
                    if (files.length > 0) handlePastedMediaFiles(files);
                  }}
                  className={`p-4 rounded-lg border-2 border-dashed transition-all text-center space-y-2.5 ${
                    isDragOver
                      ? "border-[var(--accent)] bg-[var(--bluebg)]"
                      : "border-[var(--border)] hover:border-[var(--accent)]/50 bg-[var(--surface)]"
                  }`}
                >
                  <div className="flex flex-col items-center justify-center gap-1">
                    <span className="text-2xl">📸</span>
                    <p className="text-xs font-semibold text-[var(--text)]">
                      Paste screenshots or media (Ctrl+V) to append to album
                    </p>
                    <p className="text-[11px] text-[var(--muted)]">
                      Paste photos one-by-one or in batches • Current slides: {albumItems.length} / 10
                    </p>
                  </div>

                  <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
                    {canUseClipboardRead && (
                      <button
                        type="button"
                        disabled={uploadingAlbum || pastingMedia || albumItems.length >= 10}
                        onClick={handleClipboardButtonClick}
                        className="botdesk-btn text-xs py-1.5 px-3 flex items-center gap-1.5 font-medium disabled:opacity-50"
                        title="Read image from clipboard and append to album"
                      >
                        <span>📋 Paste from Clipboard</span>
                      </button>
                    )}

                    <label className="botdesk-btn text-xs py-1.5 px-3 cursor-pointer flex items-center gap-1.5 font-medium">
                      <span>📁 Browse Files (Multi-select)</span>
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                        onChange={handleAlbumFilesChange}
                        disabled={uploadingAlbum || pastingMedia || albumItems.length >= 10}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {(uploadingAlbum || pastingMedia) && (
                  <p className="text-[11px] text-[var(--accent)] italic">
                    Uploading media items to local non-public storage...
                  </p>
                )}

                {albumUploadError && (
                  <p className="text-[11px] text-[var(--red)]">{albumUploadError}</p>
                )}

                {/* Album Items List with Reordering & Per-Slide Spoiler */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
                    <span>
                      Current Slides: {albumItems.length} / 10
                      {albumItems.length < 2 && (
                        <span className="text-[var(--red)] font-semibold ml-1">
                          (Need at least 2)
                        </span>
                      )}
                    </span>
                    <span className="text-[var(--accent)] italic">
                      #1 Slide carries the caption in Telegram
                    </span>
                  </div>

                  {albumItems.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--muted)] border border-dashed border-[var(--border)] rounded-lg">
                      No files selected yet. Choose 2–10 photos and videos above.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {albumItems.map((item, idx) => (
                        <div
                          key={item.filePath || idx}
                          className={`flex items-center justify-between p-2.5 rounded-lg border text-xs gap-3 ${
                            idx === 0
                              ? "bg-[var(--surface)] border-[var(--accent)]"
                              : "bg-[var(--panel)] border-[var(--border)]"
                          }`}
                        >
                          {/* Slide thumbnail / badge & name */}
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                idx === 0
                                  ? "bg-[var(--bluebg)] text-[var(--accent)] border border-[var(--accent)]"
                                  : "bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)]"
                              }`}
                            >
                              #{idx + 1}
                              {idx === 0 ? " (Caption)" : ""}
                            </span>

                            <div className="w-8 h-8 rounded bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center flex-shrink-0 overflow-hidden">
                              {item.mediaType === "IMAGE" ? (
                                <img
                                  src={`/api/media/posts/${item.filePath}`}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-xs">🎥</span>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-[var(--text)] truncate text-xs">
                                {item.originalName || item.filePath}
                              </p>
                              <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                                <span className="uppercase">{item.mediaType}</span>
                                <span>•</span>
                                <span>
                                  {item.sizeBytes
                                    ? (item.sizeBytes / (1024 * 1024)).toFixed(2) + " MB"
                                    : "Uploaded"}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Per-slide spoiler checkbox */}
                          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-[var(--text)] flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={Boolean(item.hasSpoiler)}
                              onChange={() => handleToggleAlbumItemSpoiler(idx)}
                              className="rounded border-[var(--border)] text-[var(--accent)]"
                            />
                            <span>🙈 Spoiler</span>
                          </label>

                          {/* Order buttons and remove */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveAlbumItem(idx, "up")}
                              className="botdesk-btn text-xs py-1 px-2 disabled:opacity-30"
                              title="Move slide up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={idx === albumItems.length - 1}
                              onClick={() => handleMoveAlbumItem(idx, "down")}
                              className="botdesk-btn text-xs py-1 px-2 disabled:opacity-30"
                              title="Move slide down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveAlbumItem(idx)}
                              className="botdesk-btn danger text-xs py-1 px-2"
                              title="Remove this item"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Content / Caption Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {postType === "TEXT" ? "Message Text" : "Caption (Optional)"}
                </label>
                <span
                  className={`text-[11px] ${
                    currentChars > maxChars
                      ? "text-[var(--red)] font-semibold"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {currentChars} / {maxChars}
                </span>
              </div>
              {currentChars > maxChars && (
                <div className="mb-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                  <span>⚠️</span>
                  <span>
                    Telegram limits media captions to {maxChars} characters. Current: {currentChars}. Please shorten caption to save or publish.
                  </span>
                </div>
              )}
              <textarea
                rows={postType === "TEXT" ? 6 : 4}
                maxLength={maxChars}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  postType === "TEXT"
                    ? "Write your channel announcement or news..."
                    : "Add an optional caption for this media..."
                }
                className="botdesk-textarea text-xs"
              />
              {postType === "TEXT" && (
                <p className="text-[11px] text-[var(--muted)] italic mt-1.5 flex items-center gap-1.5">
                  <span>💡 Tip:</span>
                  <span>You can paste a screenshot or photo directly (Ctrl+V) to automatically attach it and switch to Photo mode.</span>
                </p>
              )}
            </div>

            {/* Telegram Delivery Options */}
            <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] space-y-2.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Telegram Delivery Options
              </label>
              <div className="space-y-2">
                {/* Silent notification */}
                <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={disableNotification}
                    onChange={(e) => setDisableNotification(e.target.checked)}
                    className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)]"
                  />
                  <div>
                    <span className="font-semibold text-[var(--text)]">
                      🔕 Send Silently (disable_notification)
                    </span>
                    <p className="text-[11px] text-[var(--muted)]">
                      Subscribers receive the post without notification sound or vibration.
                    </p>
                  </div>
                </label>

                {/* Media spoiler */}
                <label
                  className={`flex items-start gap-2.5 text-xs ${
                    postType === "TEXT" || postType === "ALBUM" || sendAsDocument
                      ? "opacity-50 cursor-not-allowed"
                      : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={hasSpoiler}
                    disabled={postType === "TEXT" || postType === "ALBUM" || sendAsDocument}
                    onChange={(e) => setHasSpoiler(e.target.checked)}
                    className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)]"
                  />
                  <div>
                    <span className="font-semibold text-[var(--text)]">
                      🙈 Hide Media with Spoiler (has_spoiler)
                    </span>
                    <p className="text-[11px] text-[var(--muted)]">
                      {postType === "TEXT"
                        ? "Telegram does not support spoiler animation on text-only messages."
                        : postType === "ALBUM"
                        ? "For albums, spoiler blur is configured per slide in the album list above."
                        : sendAsDocument
                        ? "Telegram does not support spoiler animation when sending files as documents."
                        : "Blurs photo/video until channel subscribers tap to reveal."}
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Inline URL Buttons Builder */}
            <div className="space-y-2 pt-2 border-t border-[var(--border)]">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--text)]">
                    Inline URL Buttons ({buttons.length} / 10)
                  </h3>
                  <p className="text-[11px] text-[var(--muted)]">
                    {postType === "ALBUM"
                      ? "Delivered as an anchored follow-up reply message (Telegram restriction)"
                      : "Buttons appear directly under the message in Telegram"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={buttons.length >= 10}
                  onClick={() => {
                    setBtnLabel("");
                    setBtnUrl("");
                    setBtnError(null);
                    setShowButtonModal(true);
                  }}
                  className="botdesk-btn text-xs py-1 px-2.5"
                >
                  ＋ Add Button
                </button>
              </div>

              {postType === "ALBUM" && buttons.length > 0 && (
                <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-[var(--accent)] text-[11px]">
                    <span>ℹ️ Telegram Album Protocol Note</span>
                  </div>
                  <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                    Telegram does not allow inline buttons attached directly to media albums. BackStage will automatically publish these buttons in an anchored reply message immediately after the album.
                  </p>
                </div>
              )}

              {buttons.length === 0 ? (
                <div className="py-4 text-center text-[11px] text-[var(--muted)] border border-dashed border-[var(--border)] rounded-lg">
                  No inline buttons added. (Optional)
                </div>
              ) : (
                <div className="space-y-1.5">
                  {buttons.map((btn, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-semibold text-[var(--text)]">
                          {btn.label}
                        </span>
                        <span className="text-[11px] text-[var(--muted)] truncate">
                          ({btn.url})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveButton(idx)}
                        className="text-[var(--red)] hover:underline ml-2 text-xs flex-shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Publishing Timing / Schedule Choice */}
            <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Publishing Timing
                  </h3>
                  <p className="text-[11px] text-[var(--muted)]">
                    Choose whether to dispatch this post immediately or schedule for a future date & time.
                  </p>
                </div>
                <div className="flex items-center gap-1 bg-[var(--surface)] p-1 rounded-lg border border-[var(--border)] self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setPublishMode("NOW")}
                    className={`text-xs py-1 px-3 rounded-md font-medium transition ${
                      publishMode === "NOW"
                        ? "bg-[var(--accent)] text-white shadow-sm font-semibold"
                        : "text-[var(--muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    ⚡ Send Now
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPublishMode("SCHEDULE");
                      if (!scheduledDate || !scheduledTime) {
                        const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
                        const parts = getDateAndTimeInZone(inOneHour, scheduledTimezone);
                        setScheduledDate(parts.date);
                        setScheduledTime(parts.time);
                      }
                    }}
                    className={`text-xs py-1 px-3 rounded-md font-medium transition ${
                      publishMode === "SCHEDULE"
                        ? "bg-purple-600 text-white shadow-sm font-semibold"
                        : "text-[var(--muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    🕒 Schedule Post
                  </button>
                </div>
              </div>

              {publishMode === "SCHEDULE" && (
                <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Date Picker */}
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase mb-1">
                        Scheduled Date
                      </label>
                      <input
                        type="date"
                        required
                        min={new Date().toISOString().split("T")[0]}
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        className="botdesk-input text-xs w-full"
                      />
                    </div>

                    {/* Time Picker */}
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase mb-1">
                        Scheduled Time (24h)
                      </label>
                      <input
                        type="time"
                        required
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        className="botdesk-input text-xs w-full"
                      />
                    </div>
                  </div>

                  {/* Timezone Selector */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase">
                        Timezone (IANA)
                      </label>
                      <span className="text-[10px] text-purple-400 font-medium">
                        Asia/Bangkok & Asia/Yangon Supported
                      </span>
                    </div>
                    <select
                      value={scheduledTimezone}
                      onChange={(e) => setScheduledTimezone(e.target.value)}
                      className="botdesk-input text-xs w-full"
                    >
                      {COMMON_TIMEZONES.map((tz) => (
                        <option key={tz.value} value={tz.value}>
                          {tz.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Schedule Summary Box */}
                  <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-950/20 text-xs space-y-1.5">
                    <div className="flex items-center justify-between text-purple-300 font-semibold text-[11px]">
                      <span className="flex items-center gap-1.5">
                        <span>🕒 Schedule Summary</span>
                      </span>
                      <span className="botdesk-badge text-[9px] blue border-purple-500/40 text-purple-300">
                        Auto Dispatched by Worker
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] pt-1">
                      <div>
                        <span className="text-[var(--muted)]">Bot: </span>
                        <span className="font-medium text-[var(--text)]">
                          {activeBot.name} (@{activeBot.username})
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--muted)]">Target Channel: </span>
                        <span className="font-medium text-[var(--text)]">
                          {activeChannel?.name || "Selected Channel"}
                        </span>
                      </div>
                      <div className="col-span-1 sm:col-span-2">
                        <span className="text-[var(--muted)]">Broadcast Time: </span>
                        <span className="font-bold text-purple-300">
                          {scheduledDate && scheduledTime
                            ? `${scheduledDate} ${scheduledTime} (${scheduledTimezone})`
                            : "(Please select date and time above)"}
                        </span>
                      </div>
                    </div>

                    {scheduledDate && scheduledTime && (
                      <p className="text-[10px] text-[var(--muted)] pt-1 border-t border-purple-500/20 italic">
                        The BackStage background scheduler worker will claim and send this post at the exact scheduled instant without manual intervention.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons: Save Draft & Publish */}
            <div className="flex items-center justify-between pt-4 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={handleResetComposer}
                className="botdesk-btn text-xs py-2 px-3"
              >
                Clear
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingDraft || publishing}
                  onClick={handleSaveDraft}
                  className="botdesk-btn text-xs py-2 px-4"
                >
                  {savingDraft ? "Saving..." : "💾 Save Draft"}
                </button>

                {publishMode === "SCHEDULE" ? (
                  <button
                    type="button"
                    disabled={
                      savingDraft ||
                      publishing ||
                      channels.length === 0 ||
                      !scheduledDate ||
                      !scheduledTime ||
                      (postType === "TEXT" && !content.trim()) ||
                      ((postType === "IMAGE" || postType === "VIDEO") && !mediaPath) ||
                      (postType === "ALBUM" && (albumItems.length < 2 || albumItems.length > 10))
                    }
                    onClick={() => handleOpenPublish()}
                    className="botdesk-btn text-xs py-2 px-4 font-semibold bg-purple-600 hover:bg-purple-700 text-white border-transparent shadow-sm"
                  >
                    {publishing ? "Scheduling..." : "🕒 Schedule Post"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={
                      savingDraft ||
                      publishing ||
                      channels.length === 0 ||
                      (postType === "TEXT" && !content.trim()) ||
                      ((postType === "IMAGE" || postType === "VIDEO") && !mediaPath) ||
                      (postType === "ALBUM" && (albumItems.length < 2 || albumItems.length > 10))
                    }
                    onClick={() => handleOpenPublish()}
                    className="botdesk-btn primary text-xs py-2 px-4 font-semibold"
                  >
                    🚀 Publish Now
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Telegram Live Preview Simulator */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Telegram Post Preview
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {disableNotification && (
                  <span className="botdesk-badge text-[9px] paused">🔕 Silent</span>
                )}
                {postType === "ALBUM" && (
                  <span className="botdesk-badge text-[9px] blue">
                    📸 Album ({albumItems.length})
                  </span>
                )}
                {hasSpoiler && !sendAsDocument && postType !== "TEXT" && postType !== "ALBUM" && (
                  <span className="botdesk-badge text-[9px] red">🙈 Spoiler</span>
                )}
                {postType === "VIDEO" && sendAsDocument && (
                  <span className="botdesk-badge text-[9px] blue">📄 Document</span>
                )}
                <span className="botdesk-badge blue text-[10px]">Simulation</span>
              </div>
            </div>

            {/* Telegram Channel Message Bubble Simulation */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-3 shadow-inner">
              {/* Channel Header */}
              <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2">
                <div className="w-7 h-7 rounded-full bg-[var(--bluebg)] border border-[var(--accent)] flex items-center justify-center text-xs font-bold text-[var(--accent)]">
                  📢
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[var(--text)] leading-tight">
                    {activeChannel?.name || "Official Channel"}
                  </h4>
                  <span className="text-[10px] text-[var(--muted)]">
                    {activeChannel?.telegramChatId || "@channel"}
                  </span>
                </div>
              </div>

              {/* Uploaded Image Preview in Bubble */}
              {postType === "IMAGE" && (
                <div className="relative rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg)] flex items-center justify-center min-h-[140px] max-h-[260px]">
                  {mediaPath ? (
                    <img
                      src={`/api/media/posts/${mediaPath}`}
                      alt="Preview"
                      className={`w-full h-auto object-cover max-h-[260px] ${
                        hasSpoiler
                          ? "filter blur-md hover:filter-none transition-all duration-300 cursor-pointer"
                          : ""
                      }`}
                    />
                  ) : (
                    <div className="p-6 text-center text-xs text-[var(--muted)] italic">
                      [Photo Placeholder] Upload an image above to preview
                    </div>
                  )}
                  {hasSpoiler && mediaPath && (
                    <div className="absolute top-2 right-2 pointer-events-none">
                      <span className="botdesk-badge red text-[10px] font-semibold">
                        🙈 Spoiler Blur (Hover to Peek)
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Uploaded Video Preview in Bubble */}
              {postType === "VIDEO" && (
                <>
                  {sendAsDocument ? (
                    /* Video sent as Document Card */
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--bluebg)] border border-[var(--accent)] flex items-center justify-center text-xl flex-shrink-0">
                        📄
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[var(--text)] truncate">
                          {mediaOriginalName || mediaPath || "sample_video.mp4"}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                          <span>
                            {mediaSizeBytes
                              ? `${(mediaSizeBytes / (1024 * 1024)).toFixed(2)} MB`
                              : "Video Document"}
                          </span>
                          <span className="botdesk-badge text-[9px] blue">Raw Attachment</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Regular Video Player */
                    <div className="relative rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg)] flex items-center justify-center min-h-[140px] max-h-[260px]">
                      {mediaPath ? (
                        <video
                          controls
                          src={`/api/media/posts/${mediaPath}`}
                          className={`w-full max-h-[260px] object-contain ${
                            hasSpoiler
                              ? "filter blur-md hover:filter-none transition-all duration-300"
                              : ""
                          }`}
                        />
                      ) : (
                        <div className="p-6 text-center text-xs text-[var(--muted)] italic">
                          [Video Placeholder] Upload a video above to preview
                        </div>
                      )}
                      {hasSpoiler && mediaPath && (
                        <div className="absolute top-2 right-2 pointer-events-none">
                          <span className="botdesk-badge red text-[10px] font-semibold">
                            🙈 Spoiler Blur (Hover/Tap to Peek)
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Uploaded Media Album Preview in Bubble */}
              {postType === "ALBUM" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
                    <span className="font-semibold text-[var(--text)]">
                      📸 Media Album ({albumItems.length} items)
                    </span>
                    <span className="text-[10px] text-[var(--accent)] italic">
                      #1 Slide holds caption
                    </span>
                  </div>

                  {albumItems.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[var(--muted)] italic border border-[var(--border)] rounded-lg bg-[var(--bg)]">
                      [Album Placeholder] Add 2–10 photos and videos above to preview layout
                    </div>
                  ) : (
                    <div
                      className={`grid gap-1.5 rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg)] p-1 ${
                        albumItems.length === 2
                          ? "grid-cols-2"
                          : albumItems.length === 3
                          ? "grid-cols-3"
                          : "grid-cols-2 sm:grid-cols-3"
                      }`}
                    >
                      {albumItems.map((item, idx) => (
                        <div
                          key={item.filePath || idx}
                          className="relative aspect-square rounded overflow-hidden bg-black/40 flex items-center justify-center group"
                        >
                          {item.mediaType === "IMAGE" ? (
                            <img
                              src={`/api/media/posts/${item.filePath}`}
                              alt=""
                              className={`w-full h-full object-cover transition-all duration-300 ${
                                item.hasSpoiler ? "filter blur-md group-hover:filter-none" : ""
                              }`}
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-white relative">
                              <video
                                src={`/api/media/posts/${item.filePath}`}
                                className={`w-full h-full object-cover ${
                                  item.hasSpoiler ? "filter blur-md group-hover:filter-none" : ""
                                }`}
                              />
                              <span className="absolute text-lg">▶️</span>
                            </div>
                          )}

                          {/* Index badge */}
                          <div className="absolute top-1 left-1 bg-black/70 text-white text-[9px] font-bold px-1 py-0.5 rounded pointer-events-none">
                            #{idx + 1}
                            {idx === 0 ? " (Caption)" : ""}
                          </div>

                          {/* Spoiler indicator badge */}
                          {item.hasSpoiler && (
                            <div className="absolute bottom-1 right-1 bg-black/80 text-[var(--red)] text-[9px] font-bold px-1 py-0.5 rounded pointer-events-none">
                              🙈 Spoiler
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Message Content or Caption */}
              <div className="text-xs text-[var(--text)] whitespace-pre-wrap leading-relaxed">
                {content.trim() ? (
                  content
                ) : (
                  <span className="text-[var(--muted)] italic">
                    {postType === "TEXT"
                      ? "Message text will appear here..."
                      : "Optional caption will appear here..."}
                  </span>
                )}
              </div>

              {/* Inline URL Buttons in Telegram style (for single-item posts) */}
              {postType !== "ALBUM" && buttons.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {buttons.map((btn, idx) => (
                    <a
                      key={idx}
                      href={btn.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center py-1.5 px-3 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-xs font-medium text-[var(--accent)] hover:bg-[var(--bluebg)] transition truncate"
                    >
                      {btn.label} ↗
                    </a>
                  ))}
                </div>
              )}

              <div className="text-right text-[10px] text-[var(--muted)] pt-1">
                {new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>

            {/* If ALBUM and buttons exist: show follow-up reply bubble simulation */}
            {postType === "ALBUM" && buttons.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2 shadow-inner">
                <div className="flex items-center justify-between text-[10px] text-[var(--accent)] font-semibold border-b border-[var(--border)] pb-1.5">
                  <span className="flex items-center gap-1.5">
                    <span>↩️ Anchored Reply (Buttons Follow-up)</span>
                  </span>
                  <span className="botdesk-badge text-[9px] blue">Auto Reply to Album</span>
                </div>
                <div className="text-[10px] text-[var(--muted)] border-l-2 border-[var(--accent)] pl-2 italic">
                  Replying to Album #{albumItems.length > 0 ? "1" : "..."}
                </div>
                <div className="space-y-1 pt-1">
                  {buttons.map((btn, idx) => (
                    <a
                      key={idx}
                      href={btn.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center py-1.5 px-3 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-xs font-medium text-[var(--accent)] hover:bg-[var(--bluebg)] transition truncate"
                    >
                      {btn.label} ↗
                    </a>
                  ))}
                </div>
                <div className="text-right text-[10px] text-[var(--muted)]">
                  {new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            )}

            <p className="text-[11px] text-[var(--muted)] italic border-t border-[var(--border)] pt-2 leading-relaxed">
              ℹ️ Preview note: This is a browser approximation. Clicking "Publish Now" requires confirmation and dispatches the post to your real Telegram channel via Bot API.
            </p>
          </div>
        </div>
      </div>

      {/* History & Drafts Section */}
      <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--text)]">
              Post History & Drafts ({posts.length})
            </h3>
            <p className="text-xs text-[var(--muted)]">
              Drafts, scheduled broadcasts, published posts, and delivery attempts
            </p>
          </div>

          <div className="flex items-center gap-1 bg-[var(--surface)] p-1 rounded-lg border border-[var(--border)] overflow-x-auto">
            <button
              type="button"
              onClick={() => setPostFilter("ALL")}
              className={`text-xs py-1 px-2.5 rounded font-medium transition whitespace-nowrap ${
                postFilter === "ALL"
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              All ({posts.length})
            </button>
            <button
              type="button"
              onClick={() => setPostFilter("SCHEDULED")}
              className={`text-xs py-1 px-2.5 rounded font-medium transition whitespace-nowrap ${
                postFilter === "SCHEDULED"
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              🕒 Scheduled ({posts.filter((p) => p.status === "SCHEDULED").length})
            </button>
            <button
              type="button"
              onClick={() => setPostFilter("DRAFT")}
              className={`text-xs py-1 px-2.5 rounded font-medium transition whitespace-nowrap ${
                postFilter === "DRAFT"
                  ? "bg-[var(--panel)] text-[var(--text)] font-semibold border border-[var(--border)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Drafts ({posts.filter((p) => p.status === "DRAFT").length})
            </button>
            <button
              type="button"
              onClick={() => setPostFilter("PUBLISHED")}
              className={`text-xs py-1 px-2.5 rounded font-medium transition whitespace-nowrap ${
                postFilter === "PUBLISHED"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Published ({posts.filter((p) => p.status === "PUBLISHED").length})
            </button>
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="py-8 text-center text-xs text-[var(--muted)] border border-dashed border-[var(--border)] rounded-lg">
            No posts recorded yet. Compose a message and click "Save Draft" or "Schedule Post" to begin.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)] font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Options</th>
                  <th className="py-2.5 px-3">Target Channel</th>
                  <th className="py-2.5 px-3">Content Snippet</th>
                  <th className="py-2.5 px-3">Buttons</th>
                  <th className="py-2.5 px-3">Msg ID</th>
                  <th className="py-2.5 px-3">Broadcast / Date</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {posts
                  .filter((post) => {
                    if (postFilter === "SCHEDULED") return post.status === "SCHEDULED";
                    if (postFilter === "DRAFT") return post.status === "DRAFT";
                    if (postFilter === "PUBLISHED") return post.status === "PUBLISHED";
                    return true;
                  })
                  .map((post) => (
                    <tr
                      key={post.id}
                      className="hover:bg-[var(--surface)] transition"
                    >
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`botdesk-badge text-[10px] ${
                            post.status === "PUBLISHED"
                              ? "enabled"
                              : post.status === "SCHEDULED"
                              ? "blue border-purple-500/50 text-purple-300 bg-purple-950/30 font-semibold"
                              : post.status === "SENDING"
                              ? "paused"
                              : post.status === "PARTIAL"
                              ? "paused text-amber-400 border-amber-500/40"
                              : post.status === "FAILED"
                              ? "red"
                              : post.status === "UNKNOWN"
                              ? "paused"
                              : "blue"
                          }`}
                        >
                          {post.status === "SCHEDULED" ? "🕒 SCHEDULED" : post.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-medium text-[var(--text)]">
                        {post.postType === "ALBUM" ? (
                          <span className="flex items-center gap-1">
                            📸 Album
                            <span className="botdesk-badge text-[9px] blue">
                              {post.albumItems?.length || (post.albumMessageIds ? post.albumMessageIds.length : 0)} items
                            </span>
                          </span>
                        ) : post.postType === "VIDEO" ? (
                          <span className="flex items-center gap-1">
                            🎥 Video
                            {post.sendAsDocument && (
                              <span className="botdesk-badge text-[9px] blue">Doc</span>
                            )}
                          </span>
                        ) : post.postType === "IMAGE" ? (
                          "🖼️ Photo"
                        ) : (
                          "📝 Text"
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-[11px] text-[var(--muted)]">
                        <div className="flex items-center gap-1.5">
                          {post.disableNotification && (
                            <span title="Silent notification (no sound)" className="botdesk-badge text-[9px] paused">
                              🔕
                            </span>
                          )}
                          {post.hasSpoiler && (
                            <span title="Media spoiler enabled" className="botdesk-badge text-[9px] red">
                              🙈
                            </span>
                          )}
                          {!post.disableNotification && !post.hasSpoiler && (
                            <span>Standard</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)]">
                        {post.channelName || post.channelChatId || post.channelId}
                      </td>
                      <td className="py-3 px-3 max-w-xs truncate text-[var(--text)]">
                        {post.content || "(No caption/text)"}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)]">
                        {post.buttonsConfig && Array.isArray(post.buttonsConfig)
                          ? `${post.buttonsConfig.length} btn`
                          : "None"}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-mono text-[var(--muted)]">
                        {post.albumMessageIds && post.albumMessageIds.length > 0 ? (
                          <span title={`Album Message IDs: #${post.albumMessageIds.join(", #")}`}>
                            #{post.albumMessageIds[0]}..+{post.albumMessageIds.length - 1}
                            {post.buttonMessageId && (
                              <span className="text-[var(--accent)] font-semibold ml-1">
                                (+Btn #{post.buttonMessageId})
                              </span>
                            )}
                          </span>
                        ) : post.telegramMessageId ? (
                          `#${post.telegramMessageId}`
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)]">
                        {post.status === "SCHEDULED" ? (
                          <div className="space-y-0.5">
                            <span
                              className="text-purple-300 font-semibold block"
                              title={post.scheduledAt || ""}
                            >
                              🕒 {formatScheduledDisplay(post.scheduledAt, post.scheduledTimezone)}
                            </span>
                            <span className="text-[10px] text-[var(--muted)] block">
                              Created: {new Date(post.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        ) : post.status === "PUBLISHED" ? (
                          <div className="space-y-0.5">
                            <span className="text-emerald-400 font-medium block">
                              ✅ {post.sentAt ? new Date(post.sentAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "Sent"}
                            </span>
                            <span className="text-[10px] text-[var(--muted)] block">
                              Created: {new Date(post.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        ) : (
                          <div>
                            {new Date(post.createdAt).toLocaleDateString()}{" "}
                            {new Date(post.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-right space-x-1.5">
                        {post.status === "PARTIAL" && (
                          <button
                            type="button"
                            disabled={retryingButtonsPostId === post.id}
                            onClick={() => handleRetryButtons(post.id)}
                            className="botdesk-btn text-[11px] py-1 px-2 border-amber-500 text-amber-400 hover:bg-amber-500/10"
                            title="Deliver follow-up inline buttons without re-sending the album"
                          >
                            {retryingButtonsPostId === post.id ? "Retrying..." : "Retry Buttons"}
                          </button>
                        )}
                        {post.status === "SCHEDULED" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditDraft(post)}
                              className="botdesk-btn text-[11px] py-1 px-2"
                              title="Edit draft content or reschedule broadcast timing"
                            >
                              Reschedule
                            </button>
                            <button
                              type="button"
                              disabled={cancellingPostId === post.id}
                              onClick={() => handleCancelSchedule(post.id)}
                              className="botdesk-btn text-[11px] py-1 px-2 text-amber-400 border-amber-500/40 hover:bg-amber-500/10"
                              title="Cancel schedule and return to Draft status"
                            >
                              {cancellingPostId === post.id ? "Cancelling..." : "Cancel"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenPublish(post)}
                              className="botdesk-btn primary text-[11px] py-1 px-2"
                              title="Publish immediately to Telegram channel now"
                            >
                              Publish Now
                            </button>
                          </>
                        ) : post.status !== "PUBLISHED" && post.status !== "SENDING" && post.status !== "PARTIAL" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditDraft(post)}
                              className="botdesk-btn text-[11px] py-1 px-2"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenPublish(post)}
                              className="botdesk-btn primary text-[11px] py-1 px-2"
                            >
                              Publish
                            </button>
                          </>
                        ) : null}
                        {post.status !== "SENDING" && (
                          <button
                            type="button"
                            onClick={() => handleDeletePost(post.id)}
                            className="botdesk-btn danger text-[11px] py-1 px-2"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Inline Button Modal */}
      {showButtonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-[var(--panel)] border border-[var(--border)] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-[var(--text)]">
              Add Inline URL Button
            </h3>

            {btnError && (
              <div className="p-2 rounded bg-[var(--redbg)] border border-[var(--red)] text-xs text-[var(--red)]">
                {btnError}
              </div>
            )}

            <form onSubmit={handleAddButton} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold uppercase text-[var(--muted)] mb-1">
                  Button Label (Max 64 chars)
                </label>
                <input
                  type="text"
                  required
                  maxLength={64}
                  value={btnLabel}
                  onChange={(e) => setBtnLabel(e.target.value)}
                  placeholder="e.g. 🌐 Read Full Article"
                  className="botdesk-input text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase text-[var(--muted)] mb-1">
                  Destination URL (HTTPS or tg://)
                </label>
                <input
                  type="url"
                  required
                  value={btnUrl}
                  onChange={(e) => setBtnUrl(e.target.value)}
                  placeholder="https://example.com/announcement"
                  className="botdesk-input text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowButtonModal(false)}
                  className="botdesk-btn text-xs py-1.5 px-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="botdesk-btn primary text-xs py-1.5 px-4 font-semibold"
                >
                  Add Button
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Publish or Schedule Confirmation Modal */}
      {showConfirmModal && postToPublish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-[var(--panel)] border border-[var(--border)] p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-[var(--accent)]">
              <span className="text-xl">
                {postToPublish.status === "SCHEDULED" && publishMode === "SCHEDULE" ? "🕒" : "⚠️"}
              </span>
              <h3 className="text-base font-bold text-[var(--text)]">
                {postToPublish.status === "SCHEDULED" && publishMode === "SCHEDULE"
                  ? "Confirm Post Schedule"
                  : "Confirm Channel Publish"}
              </h3>
            </div>

            <p className="text-xs text-[var(--text)] leading-relaxed">
              {postToPublish.status === "SCHEDULED" && publishMode === "SCHEDULE"
                ? "You are scheduling this post for automatic broadcast. At the specified time, the BackStage scheduler worker will claim and dispatch it to your channel via Telegram Bot API."
                : "You are about to dispatch this post to your real Telegram channel. Once published, subscribers will see it immediately."}
            </p>

            <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Publishing Bot:</span>
                <span className="font-semibold text-[var(--text)]">
                  {activeBot.name} (@{activeBot.username})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Target Channel:</span>
                <span className="font-semibold text-[var(--text)]">
                  {activeChannel?.name || "Selected Channel"} ({activeChannel?.telegramChatId})
                </span>
              </div>
              {postToPublish.status === "SCHEDULED" && postToPublish.scheduledAt && (
                <div className="flex justify-between border-y border-purple-500/20 py-1 bg-purple-950/20 px-1 rounded">
                  <span className="text-purple-300 font-semibold">Scheduled Broadcast:</span>
                  <span className="font-bold text-purple-300">
                    {formatScheduledDisplay(
                      postToPublish.scheduledAt,
                      postToPublish.scheduledTimezone || scheduledTimezone
                    )}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Post Type:</span>
                <span className="font-semibold text-[var(--text)]">
                  {postToPublish.postType === "ALBUM"
                    ? `Media Album (${postToPublish.albumItems?.length || 0} items: ${
                        postToPublish.albumItems?.filter((i) => i.mediaType === "IMAGE").length || 0
                      } photo(s), ${
                        postToPublish.albumItems?.filter((i) => i.mediaType === "VIDEO").length || 0
                      } video(s))`
                    : postToPublish.postType === "VIDEO"
                    ? postToPublish.sendAsDocument
                      ? "Video with Caption (Document Attachment)"
                      : "Video with Caption (Regular Video)"
                    : postToPublish.postType === "IMAGE"
                    ? "Photo with Caption"
                    : "Text Message"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Silent Notification:</span>
                <span className="font-semibold text-[var(--text)]">
                  {postToPublish.disableNotification ? "🔕 Yes (No Sound)" : "🔔 Normal (With Sound)"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Media Spoiler Blur:</span>
                <span className="font-semibold text-[var(--text)]">
                  {postToPublish.postType === "ALBUM"
                    ? `${
                        postToPublish.albumItems?.filter((i) => i.hasSpoiler).length || 0
                      } of ${postToPublish.albumItems?.length || 0} items blurred`
                    : postToPublish.hasSpoiler
                    ? "🙈 Yes (Blurred)"
                    : "No"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Buttons:</span>
                <span className="font-semibold text-[var(--text)]">
                  {postToPublish.buttonsConfig?.length || 0} inline button(s)
                  {postToPublish.postType === "ALBUM" && (postToPublish.buttonsConfig?.length || 0) > 0
                    ? " (Dispatched in follow-up reply)"
                    : ""}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                disabled={publishing}
                onClick={() => setShowConfirmModal(false)}
                className="botdesk-btn text-xs py-2 px-3"
              >
                Cancel
              </button>
              {postToPublish.status === "SCHEDULED" && publishMode === "SCHEDULE" ? (
                <button
                  type="button"
                  disabled={publishing}
                  onClick={handleConfirmPublish}
                  className="botdesk-btn text-xs py-2 px-4 font-semibold bg-purple-600 hover:bg-purple-700 text-white border-transparent"
                >
                  {publishing ? "Scheduling..." : "Yes, Schedule Post"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={publishing}
                  onClick={handleConfirmPublish}
                  className="botdesk-btn primary text-xs py-2 px-4 font-semibold"
                >
                  {publishing ? "Publishing to Telegram..." : "Yes, Publish to Channel"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Media Replacement Confirmation Modal */}
      {pendingReplace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-[var(--panel)] border border-[var(--border)] p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-amber-400">
              <span className="text-xl">⚠️</span>
              <h3 className="text-base font-bold text-[var(--text)]">
                Replace Attached Media?
              </h3>
            </div>

            <p className="text-xs text-[var(--text)] leading-relaxed">
              A {pendingReplace.mediaType === "IMAGE" ? "photo" : "video"} is already attached to this draft:
            </p>

            <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Current Media:</span>
                <span
                  className="font-semibold text-[var(--text)] truncate max-w-[200px]"
                  title={mediaOriginalName || mediaPath || ""}
                >
                  {mediaOriginalName || mediaPath}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">New Pasted Media:</span>
                <span
                  className="font-semibold text-[var(--accent)] truncate max-w-[200px]"
                  title={pendingReplace.file.name}
                >
                  {pendingReplace.file.name}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setPendingReplace(null)}
                className="botdesk-btn text-xs py-1.5 px-3"
              >
                Keep Current Media
              </button>
              <button
                type="button"
                onClick={handleConfirmReplace}
                className="botdesk-btn primary text-xs py-1.5 px-4 font-semibold"
              >
                Yes, Replace Media
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
